// libfjs-style unit tests (specs/150). No JS engine: a fake host answers the
// callbacks, recording what libfjs-style asked for.
#include "fjs_style.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace {

int g_failures = 0;
#define CHECK(cond)                                                    \
  do {                                                                 \
    if (!(cond)) {                                                     \
      std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
      g_failures++;                                                    \
    }                                                                  \
  } while (0)

struct Frame {
  std::vector<uint8_t> b;
  Frame& u8(uint8_t v) { b.push_back(v); return *this; }
  Frame& u16(uint16_t v) { u8(v & 0xff); return u8(v >> 8); }
  Frame& u32(uint32_t v) { for (int i = 0; i < 4; i++) u8((v >> (8 * i)) & 0xff); return *this; }
  Frame& bytes(const std::string& s) { b.insert(b.end(), s.begin(), s.end()); return *this; }
  Frame& create(uint32_t id, const std::string& tag) { return u8(1).u32(id).u16(tag.size()).bytes(tag); }
  Frame& insert(uint32_t p, uint32_t c, uint32_t i) { return u8(3).u32(p).u32(c).u32(i); }
  Frame& remove(uint32_t id) { return u8(2).u32(id); }
  Frame& text(uint32_t id, const std::string& t) { return u8(5).u32(id).u32(t.size()).bytes(t); }
  Frame& el(uint32_t id, uint32_t tag, uint8_t flags = 0) { return u8(0x41).u32(id).u32(tag).u32(0).u8(flags); }
  Frame& classes(uint32_t id, std::vector<uint32_t> cs) {
    u8(0x42).u32(id).u16(cs.size());
    for (uint32_t c : cs) u32(c);
    return *this;
  }
  Frame& scope(uint32_t id, uint32_t s) { return u8(0x43).u32(id).u32(s); }
  Frame& rules(const Frame& table, uint8_t op = 0x47) { u8(op).u32(table.b.size()); b.insert(b.end(), table.b.begin(), table.b.end()); return *this; }
  Frame& atom(uint32_t a, const std::string& n) { return u8(0x40).u32(a).u16(n.size()).bytes(n); }
  Frame& attr(uint32_t id, uint32_t name, const std::string* v) {
    u8(0x48).u32(id).u32(name).u8(v ? 1 : 0).u32(v ? v->size() : 0);
    return v ? bytes(*v) : *this;
  }
};

struct Test {
  uint32_t name;  // attribute tests only
  uint8_t op;
  std::string value;
};
struct Comp {
  uint8_t comb;
  uint32_t tag;
  uint8_t pos;
  std::vector<uint32_t> classes;
  std::vector<Test> class_attr = {};
  std::vector<Test> attrs = {};
};
struct Sel {
  uint8_t flags;
  uint16_t spec;
  std::vector<Comp> comps;
};
struct RuleDef {
  uint32_t host;
  uint32_t scope;
  uint8_t kind;
  std::vector<Sel> sels;
};

Frame rule_table(const std::vector<RuleDef>& rules) {
  Frame t;
  t.u32(rules.size());
  for (const RuleDef& r : rules) {
    t.u32(r.host).u32(r.scope).u8(r.kind).u8(r.sels.size());
    for (const Sel& s : r.sels) {
      t.u8(s.flags).u16(s.spec).u8(s.comps.size());
      for (const Comp& c : s.comps) {
        t.u8(c.comb).u32(c.tag).u8(c.pos).u8(c.classes.size());
        for (uint32_t k : c.classes) t.u32(k);
        t.u8(c.class_attr.size());
        for (const Test& x : c.class_attr) t.u8(x.op).u16(x.value.size()).bytes(x.value);
        t.u8(c.attrs.size());
        for (const Test& x : c.attrs) t.u32(x.name).u8(x.op).u16(x.value.size()).bytes(x.value);
      }
    }
  }
  return t;
}

// Fake host: a match id per distinct hit set (content-keyed, as the runtime's
// StyleEngine interns MatchResults by chain), a result per compute call.
struct Host {
  std::map<std::string, uint32_t> match_by_hits;
  std::map<uint32_t, std::vector<fjs_style_hit>> hits_of;
  int define_calls = 0;
  int compute_calls = 0;
  uint32_t next_result = 1;
  std::string json;
  std::set<uint32_t> notify_matches;
  std::vector<std::pair<uint32_t, uint32_t>> styled;

  static uint32_t define_match(void* user, const fjs_style_hit* hits, uint32_t n) {
    auto* h = static_cast<Host*>(user);
    h->define_calls++;
    std::vector<fjs_style_hit> v(hits, hits + n);
    std::sort(v.begin(), v.end(), [](const fjs_style_hit& a, const fjs_style_hit& b) { return a.rule < b.rule; });
    std::string key;
    for (auto& x : v) key += std::to_string(x.rule) + ":" + std::to_string(x.plain) + "/" + std::to_string(x.active) + ";";
    auto it = h->match_by_hits.find(key);
    if (it != h->match_by_hits.end()) return it->second;
    uint32_t id = static_cast<uint32_t>(h->match_by_hits.size()) + 1;
    h->match_by_hits[key] = id;
    h->hits_of[id] = v;
    return id;
  }
  static int compute(void* user, const fjs_style_subject* sub, fjs_style_result* out) {
    auto* h = static_cast<Host*>(user);
    h->compute_calls++;
    uint32_t match = sub->match, parent = sub->parent_result;
    h->json = "{\"m\":" + std::to_string(match) + ",\"p\":" + std::to_string(parent) + "}";
    out->result = h->next_result++;
    out->flags = h->notify_matches.count(match) ? FJS_STYLE_RESULT_NOTIFY : 0;
    out->style = h->json.data();
    out->style_len = h->json.size();
    return 0;
  }
  static void on_styled(void* user, uint32_t el, uint32_t result) {
    static_cast<Host*>(user)->styled.push_back({el, result});
  }
  fjs_style_callbacks callbacks() { return {this, &Host::define_match, &Host::compute, &Host::on_styled}; }
};

// Decoded output: element -> wire style id, plus the defined JSON by id.
struct Out {
  std::map<uint32_t, uint32_t> style_of;
  std::map<uint32_t, std::string> defs;
  int set_style = 0;
  std::vector<uint8_t> passthrough;  // non-style ops, byte for byte
};

uint32_t rd32(const uint8_t* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | (uint32_t(p[3]) << 24); }

Out decode(const uint8_t* p, size_t n) {
  Out o;
  const uint8_t* end = p + n;
  while (p < end) {
    const uint8_t* start = p;
    uint8_t op = *p++;
    switch (op) {
      case 1: p += 4; p += 2 + (p[0] | (p[1] << 8)); break;
      case 2: p += 4; break;
      case 3: p += 12; break;
      case 4: p += 8; break;
      case 5: case 6: case 10: case 11: p += 8 + rd32(p + 4); break;
      case 7: {
        uint32_t id = rd32(p), len = rd32(p + 4);
        o.defs[id] = std::string(reinterpret_cast<const char*>(p + 8), len);
        p += 8 + len;
        continue;
      }
      case 8: o.style_of[rd32(p)] = rd32(p + 4); o.set_style++; p += 12; continue;
      case 9: break;
      case 12: p += 8; continue;
      default: std::fprintf(stderr, "bad op %d\n", op); return o;
    }
    o.passthrough.insert(o.passthrough.end(), start, p);
  }
  return o;
}

Out run(fjs_style* s, const Frame& f) {
  const uint8_t* out = nullptr;
  size_t len = 0;
  int rc = fjs_style_process(s, f.b.data(), f.b.size(), &out, &len);
  CHECK(rc == 0);
  return rc == 0 ? decode(out, len) : Out{};
}

// atoms
enum : uint32_t { VIEW = 1, TEXT = 2, A = 10, B = 11, C = 12, D = 13, SCOPE = 20 };

void test_passthrough_and_list() {
  Host h;
  auto cb = h.callbacks();
  fjs_style* s = fjs_style_create(&cb);
  // .b { } ; .a .b { } ; .b:first-child { } ; .c + .d { }
  Frame rules;
  rules.rules(rule_table({
      {0, 0, 0, {{0, 10, {{0, 0, 0, {B}}}}}},
      {1, 0, 0, {{0, 20, {{0, 0, 0, {A}}, {0, 0, 0, {B}}}}}},
      {2, 0, 0, {{0, 20, {{0, 0, 1, {B}}}}}},
      {3, 0, 0, {{0, 20, {{0, 0, 0, {C}}, {2, 0, 0, {D}}}}}},
  }));
  run(s, rules);

  Frame f;
  f.create(1, "view").el(1, VIEW).classes(1, {A}).insert(0, 1, 0);
  Frame plain;  // what Dart must still see, style ops stripped
  plain.create(1, "view").insert(0, 1, 0);
  for (uint32_t i = 0; i < 100; i++) {
    uint32_t id = 2 + i;
    f.create(id, "view").el(id, VIEW).classes(id, {B}).insert(1, id, i).text(id, "x");
    plain.create(id, "view").insert(1, id, i).text(id, "x");
  }
  Out o = run(s, f);
  CHECK(o.passthrough == plain.b);
  CHECK(o.set_style == 101);
  // chains: root; row 1 (first); row 2 (after a first row); rows 3–99
  // (after a middle row); row 100 (last). Three distinct rule sets, so three
  // computes.
  CHECK(h.compute_calls == 3);
  fjs_style_stats st;
  fjs_style_get_stats(s, &st);
  CHECK(st.elements == 101);
  CHECK(st.match_miss == 5);
  CHECK(st.match_hit == 96);
  // the first row matched rules 0, 1, 2; the rest 0, 1
  uint32_t first = fjs_style_result_of(s, 2), second = fjs_style_result_of(s, 3), last = fjs_style_result_of(s, 101);
  CHECK(first != second && second == last);
  CHECK(o.style_of[3] == o.style_of[101] && o.style_of[2] != o.style_of[3]);
  CHECK(o.defs.size() == 3);

  // nothing changed: nothing written
  Frame again;
  again.text(5, "y");
  Out o2 = run(s, again);
  CHECK(o2.set_style == 0);
  CHECK(o2.passthrough == again.b);

  // removing the first row makes the next one first
  Frame rm;
  rm.remove(2);
  Out o3 = run(s, rm);
  CHECK(o3.set_style == 1);
  CHECK(o3.style_of.count(3) == 1 && o3.style_of[3] == o.style_of[2]);
  fjs_style_destroy(s);
}

void test_sibling_scope_and_class_change() {
  Host h;
  auto cb = h.callbacks();
  fjs_style* s = fjs_style_create(&cb);
  // .c + .d {} (rule 7); scoped .d[data-v] {} (rule 8); :deep: [s] .d (rule 9)
  Frame rules;
  rules.rules(rule_table({
      {7, 0, 0, {{0, 20, {{0, 0, 0, {C}}, {2, 0, 0, {D}}}}}},
      {8, SCOPE, 0, {{0, 10, {{0, 0, 0, {D}}}}}},
      {9, SCOPE, 0, {{1, 10, {{0, 0, 0, {A}}, {0, 0, 0, {D}}}}}},
  }));
  run(s, rules);
  Frame f;
  f.create(1, "view").el(1, VIEW).classes(1, {A}).scope(1, SCOPE).insert(0, 1, 0);
  f.create(2, "view").el(2, VIEW).classes(2, {C}).insert(1, 2, 0);
  f.create(3, "anchor").insert(1, 3, 1);  // unregistered: invisible to `+`
  f.create(4, "view").el(4, VIEW).classes(4, {D}).insert(1, 4, 2);
  run(s, f);
  // element 4's match: rules 7 (after .c) and 9 (:deep under the scoped .a),
  // not 8 (4 itself carries no scope)
  uint32_t m4 = 0;
  for (auto& [key, id] : h.match_by_hits) {
    auto& v = h.hits_of[id];
    if (v.size() == 2 && v[0].rule == 7 && v[1].rule == 9) m4 = id;
  }
  CHECK(m4 != 0);

  // .c -> .a on the neighbour: element 4 loses rule 7
  int before = h.define_calls;
  Frame flip;
  flip.classes(2, {A});
  Out o = run(s, flip);
  CHECK(h.define_calls > before);
  CHECK(o.style_of.count(4) == 1);
  bool only9 = false;
  for (auto& [key, id] : h.match_by_hits) {
    if (h.hits_of[id].size() == 1 && h.hits_of[id][0].rule == 9) only9 = true;
  }
  CHECK(only9);

  // scope on 4 adds rule 8
  Frame sc;
  sc.scope(4, SCOPE);
  Out o2 = run(s, sc);
  CHECK(o2.style_of.count(4) == 1);
  fjs_style_destroy(s);
}

void test_notify_and_failure() {
  Host h;
  h.notify_matches.insert(1);
  auto cb = h.callbacks();
  fjs_style* s = fjs_style_create(&cb);
  Frame rules;
  rules.rules(rule_table({{0, 0, 0, {{0, 10, {{0, 0, 0, {A}}}}}}}));
  run(s, rules);
  Frame f;
  f.create(1, "view").el(1, VIEW).classes(1, {A}).insert(0, 1, 0);
  run(s, f);
  CHECK(h.styled.size() == 1 && h.styled[0].first == 1);

  // an unknown opcode fails the frame, and the instance stays failed
  Frame bad;
  bad.u8(0x7f);
  const uint8_t* out = nullptr;
  size_t len = 0;
  CHECK(fjs_style_process(s, bad.b.data(), bad.b.size(), &out, &len) < 0 && len == 0);
  CHECK(fjs_style_process(s, f.b.data(), f.b.size(), &out, &len) < 0);
  fjs_style_destroy(s);
}

uint32_t match_of(Host& h, std::vector<uint32_t> rules) {
  for (auto& [key, id] : h.match_by_hits) {
    auto& v = h.hits_of[id];
    if (v.size() != rules.size()) continue;
    bool same = true;
    for (size_t i = 0; i < v.size(); i++) same = same && v[i].rule == rules[i];
    if (same) return id;
  }
  return 0;
}

void test_attributes() {
  Host h;
  auto cb = h.callbacks();
  fjs_style* s = fjs_style_create(&cb);
  enum : uint32_t { DATA_P = 30, CLS = 31 };
  Frame f;
  f.atom(A, "a").atom(B, "van-hairline--top").atom(DATA_P, "data-popper-placement").atom(CLS, "class");
  // 20: .a[data-popper-placement^=top] .c ; 21: [class*=van-hairline] ; 22: [class] ; 23: [class~=a]
  f.rules(rule_table({
      {20, 0, 0, {{0, 20, {{0, 0, 0, {A}, {}, {{DATA_P, 4, "top"}}}, {0, 0, 0, {C}}}}}},
      {21, 0, 0, {{0, 10, {{0, 0, 0, {}, {{0, 6, "van-hairline"}}}}}}},
      {22, 0, 0, {{0, 10, {{0, 0, 0, {}, {}, {{CLS, 0, ""}}}}}}},
      {23, 0, 0, {{0, 10, {{0, 0, 0, {}, {{0, 2, "a"}}}}}}},
  }));
  f.create(1, "view").el(1, VIEW).classes(1, {A}).insert(0, 1, 0);
  f.create(2, "view").el(2, VIEW).classes(2, {C}).insert(1, 2, 0);
  f.create(3, "view").el(3, VIEW).classes(3, {B}).insert(1, 3, 1);
  run(s, f);
  CHECK(match_of(h, {22, 23}) != 0);  // element 1: [class], [class~=a]
  CHECK(match_of(h, {21, 22}) != 0);  // element 3: substring + [class]
  CHECK(match_of(h, {20, 22}) == 0);  // no placement attribute yet

  std::string top = "top-start";
  Frame a;
  a.attr(1, DATA_P, &top);
  Out o = run(s, a);
  CHECK(match_of(h, {20, 22}) != 0);  // element 2 picks up the ancestor test
  CHECK(o.style_of.count(2) == 1);
  std::string bottom = "bottom";
  Frame b;
  b.attr(1, DATA_P, &bottom);
  Out o2 = run(s, b);
  CHECK(o2.style_of.count(2) == 1);  // and drops it again
  fjs_style_destroy(s);
}

void test_append_and_bad_frame() {
  Host h;
  auto cb = h.callbacks();
  fjs_style* s = fjs_style_create(&cb);
  Frame f;
  f.rules(rule_table({{0, 0, 0, {{0, 10, {{0, 0, 0, {A}}}}}}}));
  f.create(1, "view").el(1, VIEW).classes(1, {A}).insert(0, 1, 0);
  run(s, f);
  int computes = h.compute_calls;
  // a scoped sheet for a scope nobody carries: no restyle
  Frame ap;
  ap.rules(rule_table({{1, SCOPE, 0, {{0, 10, {{0, 0, 0, {B}}}}}}}), 0x49);
  Out o = run(s, ap);
  CHECK(o.set_style == 0 && h.compute_calls == computes);
  Frame el;
  el.create(2, "view").el(2, VIEW).classes(2, {B}).scope(2, SCOPE).insert(1, 2, 0);
  run(s, el);
  CHECK(match_of(h, {1}) != 0);
  const fjs_style_hit* hits = nullptr;
  CHECK(fjs_style_hits_of(s, 2, &hits) == 1 && hits[0].rule == 1);

  // a frame that fails mid-way still hands Dart its structural ops
  Frame bad;
  bad.create(3, "view").insert(1, 3, 0).u8(0x7f);
  const uint8_t* out = nullptr;
  size_t len = 0;
  CHECK(fjs_style_process(s, bad.b.data(), bad.b.size(), &out, &len) == -1);
  Frame expect;
  expect.create(3, "view").insert(1, 3, 0);
  CHECK(out != nullptr && std::vector<uint8_t>(out, out + len) == expect.b);
  fjs_style_destroy(s);
}

// The word stream builds the same styles as the byte ops.
void test_words() {
  auto build = [](bool words, Host& h) {
    auto cb = h.callbacks();
    fjs_style* s = fjs_style_create(&cb);
    Frame rules;
    rules.rules(rule_table({
        {0, 0, 0, {{0, 10, {{0, 0, 0, {B}}}}}},
        {1, SCOPE, 0, {{0, 20, {{0, 0, 0, {A}}, {1, 0, 0, {B}}}}}},
    }));
    run(s, rules);
    Frame f;
    std::vector<uint32_t> w;
    f.create(1, "view").insert(0, 1, 0);
    if (words) w.insert(w.end(), {FJS_STYLE_W_EL, 1, VIEW, 0, 0, SCOPE, 1, A});
    else f.el(1, VIEW).scope(1, SCOPE).classes(1, {A});
    for (uint32_t i = 0; i < 20; i++) {
      uint32_t id = 2 + i;
      f.create(id, "view").insert(1, id, i);
      if (words) w.insert(w.end(), {FJS_STYLE_W_EL, id, VIEW, 0, 0, SCOPE, 1, B});
      else f.el(id, VIEW).scope(id, SCOPE).classes(id, {B});
    }
    const uint8_t* out = nullptr;
    size_t len = 0;
    CHECK(fjs_style_process_words(s, w.data(), w.size(), f.b.data(), f.b.size(), &out, &len) == 0);
    Out o = decode(out, len);
    fjs_style_destroy(s);
    return o;
  };
  Host hb, hw;
  Out bytes = build(false, hb), words = build(true, hw);
  CHECK(bytes.set_style == 21 && words.set_style == 21);
  CHECK(bytes.defs == words.defs);
  CHECK(bytes.style_of == words.style_of);
  CHECK(hb.match_by_hits == hw.match_by_hits);
}

// A CLONE builds what the same subtree built node by node builds: the same
// structure reaching Dart, the same styles.
void test_clone() {
  auto pack = [](std::vector<uint32_t>& w, const std::string& v) {
    w.push_back(static_cast<uint32_t>(v.size()));
    for (size_t i = 0; i < v.size(); i += 4) {
      uint32_t word = 0;
      for (size_t k = 0; k < 4 && i + k < v.size(); k++) word |= uint32_t(uint8_t(v[i + k])) << (8 * k);
      w.push_back(word);
    }
  };
  enum : uint32_t { TINY = 14 };
  auto build = [&](bool cloned, Host& h, std::vector<uint8_t>* structure) {
    auto cb = h.callbacks();
    fjs_style* s = fjs_style_create(&cb);
    Frame rules;
    rules.rules(rule_table({
        {0, 0, 0, {{0, 10, {{0, 0, 0, {C}}}}}},
        {1, SCOPE, 0, {{0, 20, {{0, 0, 0, {C}}, {1, 0, 0, {TINY}}}}}},
        {2, 0, 0, {{0, 10, {{0, 0, 1, {C}}}}}},  // .c:first-child
    }));
    run(s, rules);
    Frame f;
    std::vector<uint32_t> w;
    f.create(1, "view").insert(0, 1, 0);
    w.insert(w.end(), {FJS_STYLE_W_EL, 1, VIEW, 0, 0, SCOPE, 1, A});
    if (cloned) {
      // [0] view.c, [1] text.tiny "hi", [2] anchor
      w.insert(w.end(), {FJS_STYLE_W_TEMPLATE, 7, 3});
      w.insert(w.end(), {2, 0xffffffffu, VIEW, 0, SCOPE, 1, C});
      pack(w, "view"); pack(w, ""); pack(w, "");
      w.insert(w.end(), {2, 0, TEXT, 0, SCOPE, 1, TINY});
      pack(w, "text"); pack(w, ""); pack(w, "hi");
      w.insert(w.end(), {0, 0, 0, 0, 0, 0});
      pack(w, "view"); pack(w, "{\"style\":{\"display\":\"none\"}}"); pack(w, "");
    }
    for (uint32_t i = 0; i < 10; i++) {
      uint32_t id = 2 + 3 * i;
      if (cloned) {
        w.insert(w.end(), {FJS_STYLE_W_CLONE, 7, id});
      } else {
        f.create(id, "view");
        w.insert(w.end(), {FJS_STYLE_W_EL, id, VIEW, 0, 0, SCOPE, 1, C});
        f.create(id + 1, "text").text(id + 1, "hi");
        w.insert(w.end(), {FJS_STYLE_W_EL, id + 1, TEXT, 0, 0, SCOPE, 1, TINY});
        const std::string anchor = "{\"style\":{\"display\":\"none\"}}";
        f.create(id + 2, "view").u8(6).u32(id + 2).u32(anchor.size()).bytes(anchor);
        f.insert(id, id + 1, 0x7fffffff).insert(id, id + 2, 0x7fffffff);
      }
      f.insert(1, id, 0x7fffffff);
    }
    const uint8_t* out = nullptr;
    size_t len = 0;
    CHECK(fjs_style_process_words(s, w.data(), w.size(), f.b.data(), f.b.size(), &out, &len) == 0);
    Out o = decode(out, len);
    if (structure) *structure = o.passthrough;
    fjs_style_stats st;
    fjs_style_get_stats(s, &st);
    CHECK(st.elements == 21);  // the root, 10 cells, 10 texts; anchors unstyled
    fjs_style_destroy(s);
    return o;
  };
  Host hb, hc;
  std::vector<uint8_t> sb, sc;
  Out bytes = build(false, hb, &sb), cloned = build(true, hc, &sc);
  CHECK(bytes.set_style == 21 && cloned.set_style == 21);
  CHECK(bytes.style_of == cloned.style_of);
  CHECK(bytes.defs == cloned.defs);
  CHECK(sb.size() == sc.size());  // same ops reach Dart, in another order
}

}  // namespace

int main() {
  test_passthrough_and_list();
  test_sibling_scope_and_class_change();
  test_notify_and_failure();
  test_attributes();
  test_append_and_bad_frame();
  test_words();
  test_clone();
  if (g_failures) {
    std::fprintf(stderr, "fjs-style-test: %d failure(s)\n", g_failures);
    return 1;
  }
  std::printf("fjs-style-test: ok\n");
  return 0;
}
