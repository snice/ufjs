// libfjs-style core (specs/150). See include/fjs_style.h for the contract.
//
// This file mirrors the per-element half of fjs-runtime's StyleEngine
// (src/css/style.ts): the same chain key (parent chain id + own signature +
// the `+` neighbour's signature), the same candidate buckets, the same
// selector walk, the same flush order (ascending ids, repeated passes). The
// TS engine is the reference; a behaviour difference here is a bug even when
// the TS behaviour looks odd (e.g. the `+` neighbour's own neighbour is not
// part of the key there either). Keep the two in step.
#include "fjs_style.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstring>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

constexpr uint32_t kNone = 0xffffffffu;
// StyleEngine.flushPending's guard.
constexpr int kMaxPasses = 100;
// Element ids are small and dense (the runtime counts up from 1); a frame
// naming anything past this is treated as malformed rather than sized for.
constexpr uint32_t kMaxId = 1u << 24;

enum : uint8_t {
  kOpCreate = 1,
  kOpRemove = 2,
  kOpInsert = 3,
  kOpRemoveChild = 4,
  kOpSetText = 5,
  kOpSetProps = 6,
  kOpDefineStyle = 7,
  kOpSetStyle = 8,
  kOpResetStyles = 9,
  kOpCanvas = 10,
  kOpWebgl = 11,
  kOpSetHoverStyle = 12,
};

enum : uint8_t { kCombDescendant = 0, kCombChild = 1, kCombNextSibling = 2 };
enum : uint8_t { kPosFirst = 1, kPosLast = 2, kPosNotFirst = 4, kPosNotLast = 8 };
enum : uint8_t { kKindPlain = 0 };

struct Reader {
  const uint8_t* p;
  const uint8_t* end;
  bool ok = true;

  bool need(size_t n) {
    if (static_cast<size_t>(end - p) < n) {
      ok = false;
      p = end;
      return false;
    }
    return true;
  }
  uint8_t u8() { return need(1) ? *p++ : 0; }
  uint16_t u16() {
    if (!need(2)) return 0;
    uint16_t v = static_cast<uint16_t>(p[0] | (p[1] << 8));
    p += 2;
    return v;
  }
  uint32_t u32() {
    if (!need(4)) return 0;
    uint32_t v = uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
    p += 4;
    return v;
  }
  const uint8_t* skip(size_t n) {
    if (!need(n)) return nullptr;
    const uint8_t* s = p;
    p += n;
    return s;
  }
};

// Attribute test operators, as the rule table spells them.
enum : uint8_t { kAttrPresent = 0, kAttrEq = 1, kAttrWord = 2, kAttrDash = 3, kAttrPrefix = 4, kAttrSuffix = 5, kAttrSub = 6 };

struct AttrTest {
  uint8_t op = kAttrPresent;
  uint32_t name = 0;  // atom; unused for class-attribute tests
  std::string value;
};

struct Compound {
  uint8_t comb = kCombDescendant;
  uint32_t tag = 0;  // 0 = universal
  uint8_t pos = 0;
  std::vector<uint32_t> classes;  // sorted
  std::vector<AttrTest> class_attr;  // `[class<op>v]` (matchClassAttr)
  std::vector<AttrTest> attrs;       // `[name]` / `[name<op>v]` (matchAttr)
};

struct Selector {
  bool deep = false;
  bool active = false;
  bool hover = false;
  int32_t spec = 0;
  std::vector<Compound> compounds;  // subject last
};

struct Rule {
  uint32_t host = 0;
  uint32_t scope = 0;
  uint8_t kind = kKindPlain;
  std::vector<Selector> selectors;
  uint32_t stamp = 0;  // candidate-walk dedupe (StyleEngine.bucketEpoch)
};

struct Elem {
  uint32_t tag = 0;
  uint32_t defaults = 0;
  uint32_t inline_key = 0;
  bool raw = false;
  std::vector<uint32_t> classes;  // sorted, unique
  std::vector<uint32_t> classes_src;  // source order, unique (class attribute tests)
  std::vector<uint32_t> scopes;   // sorted, unique
  // reported attributes, sorted by name atom (StyleEngine.setAttribute)
  std::vector<std::pair<uint32_t, std::string>> attrs;
  uint32_t pending = 0;  // pending-set epoch it is queued in (dirtyEpoch)
  uint32_t subtree = 0;  // pending-set epoch whose subtree walk covered it
  uint32_t sig = 0;      // own signature id, 0 = stale (selfSig)
  uint32_t bits = kNone;      // last seen first/last bits (structBits)
  uint32_t prev_sig = kNone;  // last seen `+` neighbour signature (prevSig)
  uint32_t chain = 0;
  uint32_t match = 0;  // host match id, 0 = none (matched)
  uint32_t matched_epoch = 0;
  uint32_t matched_parent_chain = kNone;
  uint32_t result = 0;  // host result id
  uint32_t result_flags = 0;
  uint32_t sid = 0, aid = 0, hid = 0;  // wire ids last written
  bool applied = false;
  bool had_hover = false;
};

struct Node {
  bool live = false;
  uint32_t parent = kNone;
  uint32_t hint = 0;    // index in the parent's kids, verified before use
  uint32_t noted = 0;   // pending-set epoch its kids were all queued in
  std::vector<uint32_t> kids;
  std::unique_ptr<Elem> el;
};

struct ChainKey {
  uint32_t parent, sig, prev;
  bool operator==(const ChainKey& o) const { return parent == o.parent && sig == o.sig && prev == o.prev; }
};
struct ChainKeyHash {
  size_t operator()(const ChainKey& k) const {
    uint64_t h = k.parent * 0x9E3779B97F4A7C15ull;
    h ^= (k.sig + 0x7F4A7C15ull + (h << 6) + (h >> 2));
    h ^= (k.prev + 0x165667B1ull + (h << 6) + (h >> 2));
    return static_cast<size_t>(h);
  }
};
struct Chain {
  uint32_t id;
  uint32_t match;
};

struct ComputeKey {
  uint32_t match, parent, defaults, inline_key;
  bool raw;
  bool operator==(const ComputeKey& o) const {
    return match == o.match && parent == o.parent && defaults == o.defaults && inline_key == o.inline_key &&
           raw == o.raw;
  }
};
struct ComputeKeyHash {
  size_t operator()(const ComputeKey& k) const {
    uint64_t h = k.match * 0x9E3779B97F4A7C15ull;
    h ^= (k.parent + 0x7F4A7C15ull + (h << 6) + (h >> 2));
    h ^= (k.defaults + 0x165667B1ull + (h << 6) + (h >> 2));
    h ^= (k.inline_key + 0x27D4EB2Full + (h << 6) + (h >> 2));
    return static_cast<size_t>(h ^ (k.raw ? 1 : 0));
  }
};
struct ResultEntry {
  uint32_t host;
  uint32_t flags;
  uint32_t sid, aid, hid;
};

struct Buckets {
  std::unordered_map<uint32_t, std::vector<Rule*>> by_class;
  std::unordered_map<uint32_t, std::vector<Rule*>> by_tag;
  std::vector<Rule*> catch_all;
};

bool contains_sorted(const std::vector<uint32_t>& v, uint32_t x) { return std::binary_search(v.begin(), v.end(), x); }

bool includes_sorted(const std::vector<uint32_t>& have, const std::vector<uint32_t>& need) {
  return std::includes(have.begin(), have.end(), need.begin(), need.end());
}

bool starts_with(const std::string& s, const std::string& p) { return s.size() >= p.size() && s.compare(0, p.size(), p) == 0; }
bool ends_with(const std::string& s, const std::string& p) {
  return s.size() >= p.size() && s.compare(s.size() - p.size(), p.size(), p) == 0;
}

// StyleEngine's matchAttr on one attribute value.
bool attr_value_matches(const AttrTest& t, const std::string& attr) {
  const std::string& v = t.value;
  switch (t.op) {
    case kAttrPresent: return true;
    case kAttrEq: return attr == v;
    case kAttrWord: {
      // `attr.split(/\s+/).includes(v)`
      if (v.empty()) return false;
      size_t i = 0;
      while (i < attr.size()) {
        while (i < attr.size() && std::isspace(static_cast<unsigned char>(attr[i]))) i++;
        size_t j = i;
        while (j < attr.size() && !std::isspace(static_cast<unsigned char>(attr[j]))) j++;
        if (j > i && attr.compare(i, j - i, v) == 0 && j - i == v.size()) return true;
        i = j;
      }
      return false;
    }
    case kAttrDash: return attr == v || starts_with(attr, v + "-");
    case kAttrPrefix: return !v.empty() && starts_with(attr, v);
    case kAttrSuffix: return !v.empty() && ends_with(attr, v);
    default: return !v.empty() && attr.find(v) != std::string::npos;
  }
}

void put_u32(std::vector<uint8_t>& out, uint32_t v) {
  out.push_back(static_cast<uint8_t>(v));
  out.push_back(static_cast<uint8_t>(v >> 8));
  out.push_back(static_cast<uint8_t>(v >> 16));
  out.push_back(static_cast<uint8_t>(v >> 24));
}

}  // namespace

struct fjs_style {
  fjs_style_callbacks cb{};
  std::vector<Node> nodes;
  std::vector<std::unique_ptr<Rule>> rules;
  Buckets buckets;
  bool has_structural = false;
  bool has_sibling = false;
  // attribute names some selector tests (StyleEngine.attrNames): only these
  // join the signature and restyle on change. Sorted.
  std::vector<uint32_t> attr_names;
  // atom names, for attribute / class-attribute string tests
  std::vector<std::string> atom_names;
  uint32_t disabled_atom = kNone;  // the `:disabled` state token (DISABLED_CLASS)
  uint32_t class_atom = kNone;     // the attribute name `class`
  // each match's hits, for DevTools (fjs_style_hits_of)
  std::unordered_map<uint32_t, std::vector<fjs_style_hit>> match_hits;
  // chain ids of the seed ops of the snapshot being imported, by index
  std::vector<uint32_t> seed_chains;
  uint32_t element_count = 0;

  std::vector<uint32_t> dirty;
  uint32_t pending_epoch = 1;
  uint32_t match_epoch = 1;
  uint32_t bucket_epoch = 0;

  std::unordered_map<std::string, uint32_t> sig_ids;
  std::string sig_scratch;
  std::unordered_map<ChainKey, Chain, ChainKeyHash> chains;
  uint32_t next_chain = 1;
  std::unordered_map<ComputeKey, ResultEntry, ComputeKeyHash> computes;
  std::vector<fjs_style_hit> hits;

  // wire style table: JSON content -> id, and which ids Dart currently holds.
  // Never reset from here: a ResetStyles written by libfjs-style would also
  // drop the host op writer's entries without it knowing (plan §4 — phase 1
  // takes over the whole table). Dart's directory has no size limit of its
  // own; STYLE_TABLE_MAX is the host writer's policy.
  std::unordered_map<std::string, uint32_t> wire_ids;
  std::vector<const std::string*> wire_json;
  std::vector<bool> wire_defined;

  std::vector<uint8_t> out;
  std::vector<uint32_t> walk;
  fjs_style_stats stats{};
  bool failed = false;

  // ---- tree ------------------------------------------------------------------

  Node* node(uint32_t id) {
    if (id >= kMaxId) return nullptr;
    if (id >= nodes.size()) nodes.resize(static_cast<size_t>(id) + 1);
    return &nodes[id];
  }
  Elem* el(uint32_t id) const { return id < nodes.size() ? nodes[id].el.get() : nullptr; }

  // The parent as the style engine sees it: the implicit root container (0)
  // is not an element of the page — the runtime's parentOf never names it.
  uint32_t sparent(uint32_t id) const {
    if (id >= nodes.size()) return kNone;
    uint32_t p = nodes[id].parent;
    return p == 0 ? kNone : p;
  }

  int index_in(uint32_t pid, uint32_t id) {
    std::vector<uint32_t>& kids = nodes[pid].kids;
    uint32_t h = nodes[id].hint;
    if (h < kids.size() && kids[h] == id) return static_cast<int>(h);
    int at = -1;
    for (size_t i = 0; i < kids.size(); i++) {
      nodes[kids[i]].hint = static_cast<uint32_t>(i);
      if (kids[i] == id) at = static_cast<int>(i);
    }
    return at;
  }

  void detach(uint32_t id) {
    Node& n = nodes[id];
    if (n.parent == kNone) return;
    if (n.parent < nodes.size()) {
      std::vector<uint32_t>& kids = nodes[n.parent].kids;
      int at = index_in(n.parent, id);
      if (at >= 0) kids.erase(kids.begin() + at);
    }
    n.parent = kNone;
  }

  void drop_elem(Node& n) {
    if (n.el) {
      n.el.reset();
      element_count--;
    }
  }

  void remove_deep(uint32_t id) {
    walk.clear();
    walk.push_back(id);
    while (!walk.empty()) {
      uint32_t nid = walk.back();
      walk.pop_back();
      if (nid >= nodes.size()) continue;
      Node& n = nodes[nid];
      for (uint32_t k : n.kids) {
        if (k < nodes.size() && nodes[k].parent == nid) {
          nodes[k].parent = kNone;
          walk.push_back(k);
        }
      }
      n.kids.clear();
      drop_elem(n);
      n.live = false;
    }
  }

  // ---- dirty marking (StyleEngine.mark / markDirty / noteStructureChange) ---

  void mark(uint32_t id) {
    Elem* e = el(id);
    if (e == nullptr || e->pending == pending_epoch) return;
    e->pending = pending_epoch;
    dirty.push_back(id);
  }

  void mark_subtree(uint32_t id) {
    Elem* root = el(id);
    if (root != nullptr && root->subtree == pending_epoch) return;
    walk.clear();
    walk.push_back(id);
    size_t cap = nodes.size() * 2 + 1024;
    size_t visited = 0;
    while (!walk.empty()) {
      uint32_t nid = walk.back();
      walk.pop_back();
      if (++visited > cap || nid >= nodes.size()) break;
      Elem* e = nodes[nid].el.get();
      if (e != nullptr) {
        if (e->subtree == pending_epoch) continue;
        e->subtree = pending_epoch;
        if (e->pending != pending_epoch) {
          e->pending = pending_epoch;
          dirty.push_back(nid);
        }
      }
      for (uint32_t k : nodes[nid].kids) walk.push_back(k);
    }
  }

  void note_structure(uint32_t pid) {
    if (!has_structural && !has_sibling) return;
    if (pid == kNone || pid == 0 || pid >= nodes.size()) return;
    Node& p = nodes[pid];
    if (p.noted == pending_epoch) return;
    for (uint32_t k : p.kids) mark(k);
    p.noted = pending_epoch;
  }

  // The next participating sibling: its `+` key embeds this element's
  // signature (StyleEngine.replaceClasses marks it).
  void mark_next_sibling(uint32_t id) {
    if (!has_sibling) return;
    uint32_t pid = sparent(id);
    if (pid == kNone) return;
    int at = index_in(pid, id);
    if (at < 0) return;
    const std::vector<uint32_t>& kids = nodes[pid].kids;
    for (size_t i = static_cast<size_t>(at) + 1; i < kids.size(); i++) {
      Elem* k = el(kids[i]);
      if (k != nullptr && !k->raw) {
        mark(kids[i]);
        return;
      }
    }
  }

  void mark_all() {
    for (uint32_t id = 0; id < nodes.size(); id++) mark(id);
  }

  // ---- position (StyleEngine.structuralBits / prevElementSibling) ------------

  uint32_t structural_bits(uint32_t id) {
    uint32_t pid = sparent(id);
    if (pid == kNone) return 3;
    int at = index_in(pid, id);
    if (at < 0) return 0;
    const std::vector<uint32_t>& kids = nodes[pid].kids;
    uint32_t bits = 3;
    for (int i = at - 1; i >= 0; i--) {
      Elem* k = el(kids[i]);
      if (k != nullptr && !k->raw) {
        bits &= ~2u;
        break;
      }
    }
    for (size_t i = static_cast<size_t>(at) + 1; i < kids.size(); i++) {
      Elem* k = el(kids[i]);
      if (k != nullptr && !k->raw) {
        bits &= ~1u;
        break;
      }
    }
    return bits;
  }

  uint32_t prev_element_sibling(uint32_t id) {
    uint32_t pid = sparent(id);
    if (pid == kNone) return kNone;
    int at = index_in(pid, id);
    if (at < 0) return kNone;
    const std::vector<uint32_t>& kids = nodes[pid].kids;
    for (int i = at - 1; i >= 0; i--) {
      Elem* k = el(kids[i]);
      if (k != nullptr && !k->raw) return kids[i];
    }
    return kNone;
  }

  // ---- signatures (StyleEngine.buildChainKey / siblingSig) -------------------

  uint32_t intern_sig(const Elem& e, uint32_t bits) {
    return intern_sig_parts(e.tag, e.classes, e.scopes, bits, e.attrs);
  }

  // The signature of (tag, sorted classes, sorted scopes, position bits,
  // attributes): what StyleEngine's selfSig / siblingSig spell as a string.
  uint32_t intern_sig_parts(uint32_t tag, const std::vector<uint32_t>& classes, const std::vector<uint32_t>& scopes,
                            uint32_t bits, const std::vector<std::pair<uint32_t, std::string>>& attrs) {
    std::string& s = sig_scratch;
    s.clear();
    auto add = [&s](uint32_t v) { s.append(reinterpret_cast<const char*>(&v), sizeof v); };
    add(tag);
    add(static_cast<uint32_t>(classes.size()));
    for (uint32_t c : classes) add(c);
    add(static_cast<uint32_t>(scopes.size()));
    for (uint32_t c : scopes) add(c);
    add(bits);
    if (!attr_names.empty()) {
      for (const auto& a : attrs) {
        if (!contains_sorted(attr_names, a.first)) continue;
        add(a.first);
        add(static_cast<uint32_t>(a.second.size()));
        s.append(a.second);
      }
    }
    auto it = sig_ids.find(s);
    if (it != sig_ids.end()) return it->second;
    uint32_t id = static_cast<uint32_t>(sig_ids.size()) + 1;
    sig_ids.emplace(s, id);
    return id;
  }

  uint32_t prev_sibling_sig(uint32_t id) {
    uint32_t prev = prev_element_sibling(id);
    if (prev == kNone) return 0;
    return intern_sig(*el(prev), has_structural ? structural_bits(prev) : kNone);
  }

  // ---- selector matching (StyleEngine.matchCompoundFrom / hasScopeUp) --------

  bool match_compound_from(const Selector& sel, size_t idx, uint32_t id) {
    const Elem* e = el(id);
    if (e == nullptr) return false;
    const Compound& c = sel.compounds[idx];
    if (c.tag != 0 && e->tag != c.tag) return false;
    if (!c.classes.empty() && !includes_sorted(e->classes, c.classes)) return false;
    if (c.pos != 0) {
      uint32_t bits = structural_bits(id);
      if ((c.pos & kPosFirst) && !(bits & 2)) return false;
      if ((c.pos & kPosLast) && !(bits & 1)) return false;
      if ((c.pos & kPosNotFirst) && (bits & 2)) return false;
      if ((c.pos & kPosNotLast) && (bits & 1)) return false;
    }
    if (!c.class_attr.empty()) {
      for (const AttrTest& t : c.class_attr) {
        if (!class_attr_matches(t, *e)) return false;
      }
    }
    if (!c.attrs.empty()) {
      for (const AttrTest& t : c.attrs) {
        if (!attr_matches(t, *e)) return false;
      }
    }
    if (idx == 0) return true;
    uint8_t comb = sel.compounds[idx].comb;
    uint32_t pid = sparent(id);
    if (pid == kNone) return false;
    if (comb == kCombChild) return match_compound_from(sel, idx - 1, pid);
    if (comb == kCombNextSibling) {
      uint32_t prev = prev_element_sibling(id);
      return prev != kNone && match_compound_from(sel, idx - 1, prev);
    }
    for (uint32_t cur = pid; cur != kNone; cur = sparent(cur)) {
      if (match_compound_from(sel, idx - 1, cur)) return true;
    }
    return false;
  }

  const std::string& atom_name(uint32_t a) const {
    static const std::string empty;
    return a < atom_names.size() ? atom_names[a] : empty;
  }

  // StyleEngine's matchClassAttr: the class ATTRIBUTE rebuilt from the list
  // in source order, the `:disabled` token left out.
  bool class_attr_matches(const AttrTest& t, const Elem& e) const {
    const std::string& v = t.value;
    if (t.op == kAttrWord) {
      for (uint32_t c : e.classes_src)
        if (c != disabled_atom && atom_name(c) == v) return true;
      return false;
    }
    if (t.op == kAttrDash) {
      for (uint32_t c : e.classes_src) {
        if (c == disabled_atom) continue;
        const std::string& n = atom_name(c);
        if (n == v || starts_with(n, v + "-")) return true;
      }
      return false;
    }
    std::string attr;
    for (uint32_t c : e.classes_src) {
      if (c == disabled_atom) continue;
      if (!attr.empty()) attr += ' ';
      attr += atom_name(c);
    }
    switch (t.op) {
      case kAttrEq: return attr == v;
      case kAttrPrefix: return !v.empty() && starts_with(attr, v);
      case kAttrSuffix: return !v.empty() && ends_with(attr, v);
      default: return !v.empty() && attr.find(v) != std::string::npos;
    }
  }

  // StyleEngine's matchAttr. `[class]` alone asks whether any class is set
  // (the `:disabled` token counts, as s.classes.size does there).
  bool attr_matches(const AttrTest& t, const Elem& e) const {
    if (t.name == class_atom) return !e.classes.empty() && attr_value_matches(t, std::string());
    for (const auto& a : e.attrs) {
      if (a.first == t.name) return attr_value_matches(t, a.second);
    }
    return false;
  }

  bool has_scope_up(uint32_t id, uint32_t scope) {
    for (uint32_t cur = id; cur != kNone; cur = sparent(cur)) {
      const Elem* e = el(cur);
      if (e != nullptr && contains_sorted(e->scopes, scope)) return true;
    }
    return false;
  }

  void scan_bucket(const std::vector<Rule*>* bucket, uint32_t stamp, uint32_t id, const Elem& e) {
    if (bucket == nullptr) return;
    for (Rule* rule : *bucket) {
      if (rule->stamp == stamp) continue;
      rule->stamp = stamp;
      int32_t best_plain = -1, best_active = -1, best_hover = -1;
      bool plain_kind = rule->kind == kKindPlain;
      for (const Selector& sel : rule->selectors) {
        if (rule->scope != 0) {
          bool has = sel.deep ? has_scope_up(id, rule->scope) : contains_sorted(e.scopes, rule->scope);
          if (!has) continue;
        }
        if (!match_compound_from(sel, sel.compounds.size() - 1, id)) continue;
        if (plain_kind) {
          if (!sel.active && !sel.hover) best_plain = std::max(best_plain, sel.spec);
          if (!sel.hover) best_active = std::max(best_active, sel.spec);
          if (!sel.active) best_hover = std::max(best_hover, sel.spec);
        } else {
          // scanPseudoBucket: plain = without :active, active = any
          if (!sel.active) best_plain = std::max(best_plain, sel.spec);
          best_active = std::max(best_active, sel.spec);
        }
      }
      if (std::max(best_plain, std::max(best_active, best_hover)) < 0) continue;
      hits.push_back({rule->host, best_plain, best_active, best_hover});
    }
  }

  const std::vector<Rule*>* bucket_of(const std::unordered_map<uint32_t, std::vector<Rule*>>& m, uint32_t key) {
    auto it = m.find(key);
    return it == m.end() ? nullptr : &it->second;
  }

  // StyleEngine.matchRules. Returns the host match id, 0 on failure.
  uint32_t match_rules(uint32_t id, Elem& e) {
    uint32_t pid = sparent(id);
    const Elem* parent = pid != kNone ? el(pid) : nullptr;
    uint32_t parent_chain = parent != nullptr ? parent->chain : 0;
    if (has_structural) {
      uint32_t bits = structural_bits(id);
      if (e.bits != bits) {
        bool first_build = e.sig == 0;
        e.bits = bits;
        e.sig = 0;
        e.match = 0;
        if (!first_build) mark_subtree(id);
      }
    }
    if (has_sibling) {
      uint32_t sig = prev_sibling_sig(id);
      if (e.prev_sig != sig) {
        bool first_build = e.sig == 0 && e.prev_sig == kNone;
        e.prev_sig = sig;
        e.match = 0;
        if (!first_build) mark(id);
      }
    }
    if (e.match != 0 && e.sig != 0 && e.matched_epoch == match_epoch && e.matched_parent_chain == parent_chain) {
      stats.match_hit++;
      return e.match;
    }
    if (e.sig == 0) e.sig = intern_sig(e, has_structural ? e.bits : kNone);
    ChainKey key{parent_chain, e.sig, has_sibling ? e.prev_sig : 0};
    auto it = chains.find(key);
    if (it != chains.end()) {
      stats.match_hit++;
    } else {
      stats.match_miss++;
      hits.clear();
      uint32_t stamp = ++bucket_epoch;
      for (uint32_t cls : e.classes) scan_bucket(bucket_of(buckets.by_class, cls), stamp, id, e);
      scan_bucket(bucket_of(buckets.by_tag, e.tag), stamp, id, e);
      scan_bucket(&buckets.catch_all, stamp, id, e);
      uint32_t match =
          cb.define_match != nullptr ? cb.define_match(cb.user, hits.data(), static_cast<uint32_t>(hits.size())) : 0;
      if (match == 0) return 0;
      if (match_hits.find(match) == match_hits.end()) match_hits.emplace(match, hits);
      it = chains.emplace(key, Chain{next_chain++, match}).first;
    }
    e.chain = it->second.id;
    e.match = it->second.match;
    e.matched_epoch = match_epoch;
    e.matched_parent_chain = parent_chain;
    return e.match;
  }

  // ---- output ----------------------------------------------------------------

  uint32_t intern_wire(const char* json, size_t len) {
    if (json == nullptr) return 0;
    std::string key(json, len);
    auto it = wire_ids.find(key);
    if (it != wire_ids.end()) return it->second;
    uint32_t id = FJS_STYLE_WIRE_ID_BASE + static_cast<uint32_t>(wire_json.size());
    auto ins = wire_ids.emplace(std::move(key), id).first;
    wire_json.push_back(&ins->first);
    wire_defined.push_back(false);
    return id;
  }

  void ensure_defined(uint32_t id) {
    if (id == 0) return;
    size_t i = id - FJS_STYLE_WIRE_ID_BASE;
    if (wire_defined[i]) return;
    const std::string& json = *wire_json[i];
    out.push_back(kOpDefineStyle);
    put_u32(out, id);
    put_u32(out, static_cast<uint32_t>(json.size()));
    out.insert(out.end(), json.begin(), json.end());
    wire_defined[i] = true;
  }

  // StyleEngine.recompute. False on a failed callback.
  bool recompute(uint32_t id) {
    Elem* e = el(id);
    if (e == nullptr) return true;
    stats.recompute++;
    uint32_t match = match_rules(id, *e);
    if (match == 0) return false;
    // match_rules may have re-queued (mark_subtree): the vector can grow, the
    // Elem objects cannot move
    uint32_t pid = sparent(id);
    const Elem* parent = pid != kNone ? el(pid) : nullptr;
    uint32_t parent_result = parent != nullptr ? parent->result : 0;
    ComputeKey key{match, parent_result, e->defaults, e->inline_key, e->raw};
    auto it = computes.find(key);
    if (it != computes.end()) {
      stats.compute_hit++;
      if (it->second.sid == 0) {
        fjs_style_result r{};
        fjs_style_subject subject{id,     match,      parent_result, e->tag, e->defaults, e->inline_key,
                                  e->raw ? 1u : 0u, it->second.host};
        if (cb.compute == nullptr || cb.compute(cb.user, &subject, &r) != 0 || r.style == nullptr) return false;
        it->second.sid = intern_wire(r.style, r.style_len);
        it->second.aid = intern_wire(r.active, r.active_len);
        it->second.hid = intern_wire(r.hover, r.hover_len);
      }
    } else {
      stats.compute_miss++;
      fjs_style_result r{};
      fjs_style_subject subject{id, match, parent_result, e->tag, e->defaults, e->inline_key, e->raw ? 1u : 0u, 0};
      if (cb.compute == nullptr || cb.compute(cb.user, &subject, &r) != 0 || r.style == nullptr) {
        return false;
      }
      ResultEntry entry{r.result, r.flags, intern_wire(r.style, r.style_len), intern_wire(r.active, r.active_len),
                        intern_wire(r.hover, r.hover_len)};
      it = computes.emplace(key, entry).first;
    }
    const ResultEntry& r = it->second;
    uint32_t was_flags = e->result_flags;
    e->result = r.host;
    e->result_flags = r.flags;
    if (r.hid != 0) e->had_hover = true;
    if (e->applied && e->sid == r.sid && e->aid == r.aid && e->hid == r.hid) {
      if ((was_flags | r.flags) & FJS_STYLE_RESULT_NOTIFY) notify(id, r.host);
      return true;
    }
    stats.applied++;
    ensure_defined(r.sid);
    ensure_defined(r.aid);
    out.push_back(kOpSetStyle);
    put_u32(out, id);
    put_u32(out, r.sid);
    put_u32(out, r.aid);
    if (e->had_hover) {
      ensure_defined(r.hid);
      out.push_back(kOpSetHoverStyle);
      put_u32(out, id);
      put_u32(out, r.hid);
    }
    e->applied = true;
    e->sid = r.sid;
    e->aid = r.aid;
    e->hid = r.hid;
    if ((was_flags | r.flags) & FJS_STYLE_RESULT_NOTIFY) notify(id, r.host);
    return true;
  }

  void notify(uint32_t id, uint32_t result) {
    if (cb.styled != nullptr) cb.styled(cb.user, id, result);
  }

  bool flush() {
    if (dirty.empty()) return true;
    auto t0 = std::chrono::steady_clock::now();
    std::vector<uint32_t> ids;
    bool ok = true;
    for (int pass = 0; pass < kMaxPasses && !dirty.empty() && ok; pass++) {
      ids.swap(dirty);
      dirty.clear();
      pending_epoch++;
      std::sort(ids.begin(), ids.end());
      for (uint32_t id : ids) {
        if (!recompute(id)) {
          ok = false;
          break;
        }
      }
    }
    stats.flush_ms += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    return ok;
  }

  // ---- rule table ------------------------------------------------------------

  void drop_caches() {
    match_epoch++;
    chains.clear();
    computes.clear();
    match_hits.clear();
    for (Node& n : nodes) {
      if (!n.el) continue;
      n.el->sig = 0;
      n.el->bits = kNone;
      n.el->prev_sig = kNone;
      n.el->match = 0;
    }
  }

  // A signature in a seed op: u32 tag, u16 n + class atoms, u16 n + scope
  // atoms, u32 bits (0xffffffff = none), then for a chain's own signature
  // u16 n + (u32 name atom, u32 len, utf8 value) attributes.
  static void read_sig(Reader& r, uint32_t& tag, std::vector<uint32_t>& classes, std::vector<uint32_t>& scopes,
                       uint32_t& bits, std::vector<std::pair<uint32_t, std::string>>* attrs) {
    tag = r.u32();
    classes.clear();
    scopes.clear();
    for (uint16_t n = r.u16(), i = 0; i < n && r.ok; i++) classes.push_back(r.u32());
    for (uint16_t n = r.u16(), i = 0; i < n && r.ok; i++) scopes.push_back(r.u32());
    std::sort(classes.begin(), classes.end());
    classes.erase(std::unique(classes.begin(), classes.end()), classes.end());
    std::sort(scopes.begin(), scopes.end());
    scopes.erase(std::unique(scopes.begin(), scopes.end()), scopes.end());
    bits = r.u32();
    if (attrs == nullptr) return;
    attrs->clear();
    for (uint16_t n = r.u16(), i = 0; i < n && r.ok; i++) {
      uint32_t name = r.u32();
      uint32_t len = r.u32();
      const uint8_t* v = r.skip(len);
      if (v != nullptr) attrs->emplace_back(name, std::string(reinterpret_cast<const char*>(v), len));
    }
    std::sort(attrs->begin(), attrs->end());
  }

  static bool read_test(Reader& r, bool named, AttrTest& t) {
    if (named) t.name = r.u32();
    t.op = r.u8();
    uint16_t len = r.u16();
    const uint8_t* v = r.skip(len);
    if (v != nullptr) t.value.assign(reinterpret_cast<const char*>(v), len);
    return r.ok;
  }

  void index_rule(Rule* rule) {
    // indexRule: a class of the subject, else its tag, else the catch-all.
    // The TS index keys on the FIRST class in source order; any one works
    // (subject matching requires all of them), so sorted order is fine.
    for (const Selector& sel : rule->selectors) {
      const Compound& subject = sel.compounds.back();
      if (!subject.classes.empty()) {
        buckets.by_class[subject.classes.front()].push_back(rule);
      } else if (subject.tag != 0) {
        buckets.by_tag[subject.tag].push_back(rule);
      } else {
        buckets.catch_all.push_back(rule);
      }
    }
  }

  // RULES replaces the table and invalidates everything. RULES_APPEND adds a
  // table the host judged unable to change any cached answer (a scoped sheet
  // whose scope no element has carried, register()'s fast path) — unless it
  // changes the shape flags or the tested attribute names, which decide the
  // signature format: then it invalidates like RULES.
  bool load_rules(Reader& r, bool append) {
    std::vector<std::unique_ptr<Rule>> next;
    uint32_t n = r.u32();
    bool structural = append && has_structural, sibling = append && has_sibling;
    std::vector<uint32_t> names = append ? attr_names : std::vector<uint32_t>{};
    for (uint32_t i = 0; i < n && r.ok; i++) {
      auto rule = std::make_unique<Rule>();
      rule->host = r.u32();
      rule->scope = r.u32();
      rule->kind = r.u8();
      uint8_t nsel = r.u8();
      for (uint8_t s = 0; s < nsel && r.ok; s++) {
        Selector sel;
        uint8_t flags = r.u8();
        sel.deep = flags & 1;
        sel.active = flags & 2;
        sel.hover = flags & 4;
        sel.spec = r.u16();
        uint8_t ncomp = r.u8();
        if (ncomp == 0) return false;
        for (uint8_t c = 0; c < ncomp && r.ok; c++) {
          Compound comp;
          comp.comb = r.u8();
          comp.tag = r.u32();
          comp.pos = r.u8();
          uint8_t ncls = r.u8();
          for (uint8_t k = 0; k < ncls && r.ok; k++) comp.classes.push_back(r.u32());
          std::sort(comp.classes.begin(), comp.classes.end());
          comp.classes.erase(std::unique(comp.classes.begin(), comp.classes.end()), comp.classes.end());
          uint8_t ncattr = r.u8();
          for (uint8_t k = 0; k < ncattr && r.ok; k++) {
            AttrTest t;
            if (read_test(r, false, t)) comp.class_attr.push_back(std::move(t));
          }
          uint8_t nattr = r.u8();
          for (uint8_t k = 0; k < nattr && r.ok; k++) {
            AttrTest t;
            if (!read_test(r, true, t)) break;
            // `class` is the class list, not a reported attribute
            if (t.name != class_atom && !contains_sorted(names, t.name)) {
              names.insert(std::upper_bound(names.begin(), names.end(), t.name), t.name);
            }
            comp.attrs.push_back(std::move(t));
          }
          if (comp.pos != 0) structural = true;
          if (c > 0 && comp.comb == kCombNextSibling) sibling = true;
          sel.compounds.push_back(std::move(comp));
        }
        rule->selectors.push_back(std::move(sel));
      }
      next.push_back(std::move(rule));
    }
    if (!r.ok) return false;
    bool reshaped = structural != has_structural || sibling != has_sibling || names != attr_names;
    if (append) {
      for (auto& rule : next) {
        index_rule(rule.get());
        rules.push_back(std::move(rule));
      }
    } else {
      rules.swap(next);
      buckets = Buckets{};
      for (auto& rule : rules) index_rule(rule.get());
    }
    has_structural = structural;
    has_sibling = sibling;
    attr_names.swap(names);
    if (!append || reshaped) {
      drop_caches();
      mark_all();
    }
    return true;
  }

  // ---- frame -----------------------------------------------------------------

  // One op. Returns false on a malformed op; `copy` says whether its bytes
  // go on to Dart.
  bool op(Reader& r, uint8_t code, bool& copy) {
    copy = code < FJS_STYLE_OP_FIRST;
    switch (code) {
      case kOpCreate: {
        uint32_t id = r.u32();
        r.skip(r.u16());
        Node* n = node(id);
        if (n == nullptr) return false;
        n->live = true;
        return r.ok;
      }
      case kOpRemove: {
        uint32_t id = r.u32();
        if (!r.ok || node(id) == nullptr) return false;
        uint32_t pid = nodes[id].parent;
        detach(id);
        remove_deep(id);
        note_structure(pid);
        return true;
      }
      case kOpInsert: {
        uint32_t pid = r.u32();
        uint32_t id = r.u32();
        uint32_t index = r.u32();
        if (!r.ok || node(pid) == nullptr || node(id) == nullptr) return false;
        uint32_t old = nodes[id].parent;
        // mirror_tree.dart: move semantics, clamped index
        detach(id);
        std::vector<uint32_t>& kids = nodes[pid].kids;
        size_t at = std::min<size_t>(index, kids.size());
        kids.insert(kids.begin() + static_cast<std::ptrdiff_t>(at), id);
        nodes[id].parent = pid;
        nodes[id].hint = static_cast<uint32_t>(at);
        // the runtime's insert: recomputeSubtree(child) + noteStructureChange
        mark_subtree(id);
        if (old != kNone && old != pid) note_structure(old);
        note_structure(pid);
        return true;
      }
      case kOpRemoveChild: {
        uint32_t pid = r.u32();
        uint32_t id = r.u32();
        if (!r.ok || node(pid) == nullptr || node(id) == nullptr) return false;
        if (nodes[id].parent == pid) detach(id);
        note_structure(pid);
        return true;
      }
      case kOpSetText:
      case kOpSetProps:
      case kOpDefineStyle:
      case kOpCanvas:
      case kOpWebgl:
        r.u32();
        r.skip(r.u32());
        return r.ok;
      case kOpSetStyle:
        r.skip(12);
        return r.ok;
      case kOpResetStyles:
        // Dart drops its whole directory, ours included
        std::fill(wire_defined.begin(), wire_defined.end(), false);
        return true;
      case kOpSetHoverStyle:
        r.skip(8);
        return r.ok;

      case FJS_STYLE_OP_ATOM: {
        // names only matter to attribute tests; matching compares ids
        uint32_t atom = r.u32();
        uint16_t len = r.u16();
        const uint8_t* name = r.skip(len);
        if (name == nullptr || atom >= kMaxId) return false;
        if (atom >= atom_names.size()) atom_names.resize(static_cast<size_t>(atom) + 1);
        atom_names[atom].assign(reinterpret_cast<const char*>(name), len);
        if (atom_names[atom] == ":disabled") disabled_atom = atom;
        if (atom_names[atom] == "class") class_atom = atom;
        return true;
      }
      case FJS_STYLE_OP_ATTR: {
        uint32_t id = r.u32();
        uint32_t name = r.u32();
        uint8_t present = r.u8();
        uint32_t len = r.u32();
        const uint8_t* v = r.skip(len);
        if (!r.ok) return false;
        Elem* e = el(id);
        if (e == nullptr) return true;
        auto it = std::lower_bound(e->attrs.begin(), e->attrs.end(), name,
                                   [](const std::pair<uint32_t, std::string>& a, uint32_t n) { return a.first < n; });
        bool has = it != e->attrs.end() && it->first == name;
        if (present) {
          std::string value(reinterpret_cast<const char*>(v), len);
          if (has && it->second == value) return true;
          if (has) it->second.swap(value);
          else e->attrs.insert(it, {name, std::move(value)});
        } else {
          if (!has) return true;
          e->attrs.erase(it);
        }
        if (!contains_sorted(attr_names, name)) return true;
        e->sig = 0;
        e->match = 0;
        mark_subtree(id);
        mark_next_sibling(id);
        return true;
      }
      case FJS_STYLE_OP_EL: {
        uint32_t id = r.u32();
        uint32_t tag = r.u32();
        uint32_t defaults = r.u32();
        uint8_t flags = r.u8();
        Node* n = node(id);
        if (!r.ok || n == nullptr) return false;
        if (n->el) return true;  // StyleEngine.ensure: first registration wins
        n->el = std::make_unique<Elem>();
        element_count++;
        Elem& e = *n->el;
        e.tag = tag;
        e.defaults = defaults;
        e.raw = flags & 1;
        e.pending = pending_epoch;
        if (n->kids.empty()) e.subtree = pending_epoch;
        dirty.push_back(id);
        return true;
      }
      case FJS_STYLE_OP_CLASSES: {
        uint32_t id = r.u32();
        uint16_t count = r.u16();
        std::vector<uint32_t> classes;
        classes.reserve(count);
        for (uint16_t i = 0; i < count && r.ok; i++) classes.push_back(r.u32());
        if (!r.ok) return false;
        Elem* e = el(id);
        if (e == nullptr) return true;
        // source order kept for class attribute tests, first occurrence wins
        std::vector<uint32_t> src;
        src.reserve(classes.size());
        for (uint32_t c : classes)
          if (std::find(src.begin(), src.end(), c) == src.end()) src.push_back(c);
        std::sort(classes.begin(), classes.end());
        classes.erase(std::unique(classes.begin(), classes.end()), classes.end());
        if (src == e->classes_src) return true;
        e->classes_src.swap(src);
        e->classes.swap(classes);
        e->sig = 0;
        e->match = 0;
        mark_subtree(id);
        mark_next_sibling(id);
        return true;
      }
      case FJS_STYLE_OP_SCOPE: {
        uint32_t id = r.u32();
        uint32_t scope = r.u32();
        if (!r.ok) return false;
        Elem* e = el(id);
        if (e == nullptr || contains_sorted(e->scopes, scope)) return true;
        e->scopes.insert(std::upper_bound(e->scopes.begin(), e->scopes.end(), scope), scope);
        e->sig = 0;
        e->match = 0;
        mark_subtree(id);
        mark_next_sibling(id);
        return true;
      }
      case FJS_STYLE_OP_INLINE: {
        uint32_t id = r.u32();
        uint32_t key = r.u32();
        if (!r.ok) return false;
        Elem* e = el(id);
        if (e == nullptr || e->inline_key == key) return true;
        e->inline_key = key;
        mark_subtree(id);
        return true;
      }
      case FJS_STYLE_OP_FORGET: {
        uint32_t id = r.u32();
        if (!r.ok) return false;
        if (id < nodes.size()) drop_elem(nodes[id]);
        return true;
      }
      case FJS_STYLE_OP_RESTYLE: {
        uint32_t id = r.u32();
        uint8_t subtree = r.u8();
        if (!r.ok) return false;
        if (id == 0) {
          drop_caches();
          mark_all();
        } else if (subtree) {
          mark_subtree(id);
        } else {
          mark(id);
        }
        return true;
      }
      case FJS_STYLE_OP_SEED_CHAIN: {
        uint32_t seed = r.u32();
        uint32_t parent_seed = r.u32();
        uint32_t tag = 0, bits = kNone;
        std::vector<uint32_t> classes, scopes;
        std::vector<std::pair<uint32_t, std::string>> attrs;
        read_sig(r, tag, classes, scopes, bits, &attrs);
        uint32_t sig = intern_sig_parts(tag, classes, scopes, bits, attrs);
        uint32_t prev = 0;
        if (r.u8() != 0) {
          read_sig(r, tag, classes, scopes, bits, nullptr);
          prev = intern_sig_parts(tag, classes, scopes, bits, {});
        }
        uint32_t match = r.u32();
        if (!r.ok || match == 0) return false;
        if (seed == 0) seed_chains.clear();
        if (seed != seed_chains.size()) return false;
        uint32_t parent = 0;
        if (parent_seed != 0) {
          if (parent_seed > seed_chains.size()) return false;
          parent = seed_chains[parent_seed - 1];
        }
        ChainKey key{parent, sig, has_sibling ? prev : 0};
        auto it = chains.find(key);
        if (it == chains.end()) it = chains.emplace(key, Chain{next_chain++, match}).first;
        seed_chains.push_back(it->second.id);
        return true;
      }
      case FJS_STYLE_OP_SEED_COMPUTE: {
        ComputeKey key{};
        key.match = r.u32();
        key.parent = r.u32();
        key.defaults = r.u32();
        key.inline_key = r.u32();
        key.raw = r.u8() != 0;
        uint32_t result = r.u32();
        uint32_t flags = r.u32();
        if (!r.ok || result == 0) return false;
        // sid 0: described on first use (fjs_style_subject.seeded)
        computes.emplace(key, ResultEntry{result, flags, 0, 0, 0});
        return true;
      }
      case FJS_STYLE_OP_RULES:
      case FJS_STYLE_OP_RULES_APPEND: {
        uint32_t len = r.u32();
        const uint8_t* body = r.skip(len);
        if (body == nullptr) return false;
        Reader rr{body, body + len};
        return load_rules(rr, code == FJS_STYLE_OP_RULES_APPEND);
      }
      default:
        return false;
    }
  }

  int process(const uint8_t* in, size_t len) {
    out.clear();
    out.reserve(len + 64);
    Reader r{in, in + len};
    const uint8_t* copy_from = in;
    while (r.p < r.end) {
      const uint8_t* start = r.p;
      uint8_t code = r.u8();
      bool copy = true;
      if (!op(r, code, copy)) {
        strip(in, len);
        return -1;
      }
      if (!copy) {
        out.insert(out.end(), copy_from, start);
        copy_from = r.p;
      }
    }
    out.insert(out.end(), copy_from, r.end);
    if (!flush()) {
      strip(in, len);
      return -2;
    }
    return 0;
  }

  // A failed frame still reaches Dart with its structure: the frame minus
  // the style input ops, as far as it parses. Styles written by this
  // frame's flush are dropped with it.
  void strip(const uint8_t* in, size_t len) {
    out.resize(len);
    out.resize(fjs_style_strip(in, len, out.data()));
  }
};

extern "C" {

size_t fjs_style_strip(const uint8_t* in, size_t len, uint8_t* out) {
  Reader r{in, in + len};
  size_t n = 0;
  while (r.p < r.end) {
    const uint8_t* start = r.p;
    uint8_t code = r.u8();
    switch (code) {
      case kOpCreate: r.u32(); r.skip(r.u16()); break;
      case kOpRemove: r.skip(4); break;
      case kOpInsert: case kOpSetStyle: r.skip(12); break;
      case kOpRemoveChild: case kOpSetHoverStyle: r.skip(8); break;
      case kOpSetText: case kOpSetProps: case kOpDefineStyle: case kOpCanvas: case kOpWebgl:
        r.u32(); r.skip(r.u32()); break;
      case kOpResetStyles: break;
      case FJS_STYLE_OP_ATOM: r.u32(); r.skip(r.u16()); break;
      case FJS_STYLE_OP_EL: r.skip(13); break;
      case FJS_STYLE_OP_CLASSES: r.u32(); r.skip(4u * r.u16()); break;
      case FJS_STYLE_OP_SCOPE: case FJS_STYLE_OP_INLINE: r.skip(8); break;
      case FJS_STYLE_OP_FORGET: r.skip(4); break;
      case FJS_STYLE_OP_RESTYLE: r.skip(5); break;
      case FJS_STYLE_OP_RULES: case FJS_STYLE_OP_RULES_APPEND: r.skip(r.u32()); break;
      case FJS_STYLE_OP_ATTR: r.skip(9); r.skip(r.u32()); break;
      case FJS_STYLE_OP_SEED_CHAIN: case FJS_STYLE_OP_SEED_COMPUTE:
        // variable-length and never mixed into a frame Dart needs whole:
        // a strip stops here
        return n;
      default: return n;
    }
    if (!r.ok) return n;
    if (code < FJS_STYLE_OP_FIRST) {
      std::memmove(out + n, start, static_cast<size_t>(r.p - start));
      n += static_cast<size_t>(r.p - start);
    }
  }
  return n;
}

fjs_style* fjs_style_create(const fjs_style_callbacks* callbacks) {
  auto* s = new fjs_style();
  if (callbacks != nullptr) s->cb = *callbacks;
  s->nodes.resize(1);  // 0: the host's implicit root container
  s->nodes[0].live = true;
  return s;
}

void fjs_style_destroy(fjs_style* style) { delete style; }

int fjs_style_process(fjs_style* style, const uint8_t* in, size_t len, const uint8_t** out, size_t* out_len) {
  *out = nullptr;
  *out_len = 0;
  if (style->failed) return -3;
  int rc = style->process(in, len);
  if (rc != 0) {
    style->failed = true;
    *out = style->out.data();
    *out_len = style->out.size();
    return rc;
  }
  *out = style->out.data();
  *out_len = style->out.size();
  return 0;
}

size_t fjs_style_hits_of(const fjs_style* style, uint32_t element, const fjs_style_hit** hits) {
  *hits = nullptr;
  const Elem* e = style->el(element);
  if (e == nullptr || e->match == 0) return 0;
  auto it = style->match_hits.find(e->match);
  if (it == style->match_hits.end() || it->second.empty()) return 0;
  *hits = it->second.data();
  return it->second.size();
}

uint32_t fjs_style_result_of(const fjs_style* style, uint32_t element) {
  const Elem* e = style->el(element);
  return e != nullptr ? e->result : 0;
}

size_t fjs_style_classes_of(const fjs_style* style, uint32_t element, const uint32_t** atoms) {
  const Elem* e = style->el(element);
  if (e == nullptr || e->classes.empty()) {
    *atoms = nullptr;
    return 0;
  }
  *atoms = e->classes.data();
  return e->classes.size();
}

void fjs_style_get_stats(const fjs_style* style, fjs_style_stats* out) {
  *out = style->stats;
  out->elements = style->element_count;
  out->rules = static_cast<uint32_t>(style->rules.size());
}

void fjs_style_reset_stats(fjs_style* style) { style->stats = fjs_style_stats{}; }

}  // extern "C"
