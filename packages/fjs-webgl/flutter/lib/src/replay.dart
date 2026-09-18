// WebGL command-stream decoding and execution — the Dart twin of the
// @ufjs/webgl npm package's src/protocol.ts. Both files list the same
// command ids in the same order and must move together, exactly like
// flutter_fjs's canvas_ops.dart and the runtime's display-list.ts.
//
// Retention model (the one place this differs from the 2d display list):
// op-10 chunks are REPLAYED — the host keeps them and repaints on demand.
// These chunks are EXECUTED — each one runs into the node's GL framebuffer
// as it arrives and the node's texture is then marked for display. The
// framebuffer is the state; nothing is kept beyond the queue of chunks that
// arrived before the GL context existed (they land on MirrorNode.webglChunks
// in the core, and this module drains them).
//
// The GPU work lives behind [FjsGlBindings], an interface of int-handle GL
// calls, so the decoder ([WebglChunkDecoder]) is testable without a device.
// [FjsAngleBindings] is the flutter_angle implementation and is the ONLY
// place in this package that touches flutter_angle: if that plugin stalls,
// this file is the whole swap surface (spec 021 §1.1).
import 'dart:async';
import 'dart:io' show Platform;
import 'dart:typed_data';

import 'package:flutter/widgets.dart' show Size, WidgetsBinding, debugPrint;
import 'package:flutter_angle/flutter_angle.dart';

import 'gl_state.dart';
import 'ohos_surface.dart';
import 'package:flutter_fjs/flutter_fjs.dart'
    show
        CanvasChunkReader,
        CanvasOpException,
        FjsCanvasImages,
        MirrorNode;

/// GL command ids. Twin of @ufjs/webgl's `WebglCmd`.
abstract final class WebglCmd {
  static const strDef = 0x0001;
  // u16 id, u32 len, utf8 — three.js's shader sources exceed the 64 KiB a
  // u16 length can express (spec 023 iOS)
  static const strDef32 = 0x0002;

  // resources
  static const createBuffer = 0x0101;
  static const deleteBuffer = 0x0102;
  static const createFramebuffer = 0x0103;
  static const deleteFramebuffer = 0x0104;
  static const createProgram = 0x0105;
  static const deleteProgram = 0x0106;
  static const createRenderbuffer = 0x0107;
  static const deleteRenderbuffer = 0x0108;
  static const createShader = 0x0109;
  static const deleteShader = 0x010a;
  static const createTexture = 0x010b;
  static const deleteTexture = 0x010c;

  // binding & state
  static const activeTexture = 0x0201;
  static const bindBuffer = 0x0202;
  static const bindFramebuffer = 0x0203;
  static const bindRenderbuffer = 0x0204;
  static const bindTexture = 0x0205;
  static const blendColor = 0x0206;
  static const blendEquation = 0x0207;
  static const blendEquationSeparate = 0x0208;
  static const blendFunc = 0x0209;
  static const blendFuncSeparate = 0x020a;
  static const clearColor = 0x020b;
  static const clearDepth = 0x020c;
  static const clearStencil = 0x020d;
  static const colorMask = 0x020e;
  static const cullFace = 0x020f;
  static const depthFunc = 0x0210;
  static const depthMask = 0x0211;
  static const depthRange = 0x0212;
  static const disable = 0x0213;
  static const enable = 0x0214;
  static const frontFace = 0x0215;
  static const hint = 0x0216;
  static const lineWidth = 0x0217;
  static const pixelStorei = 0x0218;
  static const polygonOffset = 0x0219;
  static const sampleCoverage = 0x021a;
  static const scissor = 0x021b;
  static const stencilFunc = 0x021c;
  static const stencilFuncSeparate = 0x021d;
  static const stencilMask = 0x021e;
  static const stencilMaskSeparate = 0x021f;
  static const stencilOp = 0x0220;
  static const stencilOpSeparate = 0x0221;
  static const viewport = 0x0222;

  // data upload
  static const bufferData = 0x0301;
  static const bufferDataSize = 0x0302;
  static const bufferSubData = 0x0303;
  static const texImage2D = 0x0304;
  static const texImage2DSource = 0x0305;
  static const texSubImage2D = 0x0306;
  static const texParameterf = 0x0307;
  static const texParameteri = 0x0308;
  static const generateMipmap = 0x0309;
  // three.js r163+ uploads every image texture through texStorage2D +
  // texSubImage2D(source) (spec 023)
  static const texStorage2D = 0x030a;
  static const texSubImage2DSource = 0x030b;
  // three.js's WebGLState seeds empty 3D/array textures at renderer init
  static const texImage3D = 0x030c;
  static const texSubImage3D = 0x030d;

  // program
  static const shaderSource = 0x0401;
  static const compileShader = 0x0402;
  static const attachShader = 0x0403;
  static const detachShader = 0x0404;
  static const linkProgram = 0x0405;
  static const useProgram = 0x0406;
  static const validateProgram = 0x0407;
  static const bindAttribLocation = 0x0408;

  // vertex & uniform
  static const enableVertexAttribArray = 0x0501;
  static const disableVertexAttribArray = 0x0502;
  static const vertexAttribPointer = 0x0503;
  static const vertexAttribDivisor = 0x050c;
  static const vertexAttrib1f = 0x0504;
  static const vertexAttrib2f = 0x0505;
  static const vertexAttrib3f = 0x0506;
  static const vertexAttrib4f = 0x0507;
  static const vertexAttrib1fv = 0x0508;
  static const vertexAttrib2fv = 0x0509;
  static const vertexAttrib3fv = 0x050a;
  static const vertexAttrib4fv = 0x050b;
  static const uniform1i = 0x0510;
  static const uniform2i = 0x0511;
  static const uniform3i = 0x0512;
  static const uniform4i = 0x0513;
  static const uniform1f = 0x0514;
  static const uniform2f = 0x0515;
  static const uniform3f = 0x0516;
  static const uniform4f = 0x0517;
  static const uniform1iv = 0x0518;
  static const uniform2iv = 0x0519;
  static const uniform3iv = 0x051a;
  static const uniform4iv = 0x051b;
  static const uniform1fv = 0x051c;
  static const uniform2fv = 0x051d;
  static const uniform3fv = 0x051e;
  static const uniform4fv = 0x051f;
  static const uniformMatrix2fv = 0x0520;
  static const uniformMatrix3fv = 0x0521;
  static const uniformMatrix4fv = 0x0522;

  // draw
  static const clear = 0x0601;
  static const drawArrays = 0x0602;
  static const drawElements = 0x0603;
  static const finish = 0x0604;
  static const flush = 0x0605;
  // WebGL2 core instancing (spec 033): the non-instanced fields, then
  // instanceCount
  static const drawArraysInstanced = 0x0606;
  static const drawElementsInstanced = 0x0607;

  // framebuffer
  static const framebufferTexture2D = 0x0701;
  static const framebufferRenderbuffer = 0x0702;
  static const renderbufferStorage = 0x0703;

  // vertex arrays (WebGL 2; three.js's WebGLBindingStates wraps every draw
  // in a VAO unconditionally, spec 023 — the 0x09xx family spec 021 reserved)
  static const createVertexArray = 0x0901;
  static const bindVertexArray = 0x0902;
  static const deleteVertexArray = 0x0903;
}

/// texImage2D's 6-arg source form kinds. Pixels take the 9-arg form.
abstract final class TexSource {
  static const imageHandle = 1;
}

/// `getShaderParameter`/`getProgramParameter` pnames split by result type, so
/// the pre-context optimistic branch can answer a boolean query with a boolean
/// and a counting query with a number. JS reads `true` as 1, so answering the
/// counting ones with `true` invents a shader input that does not exist.
const _shaderStatusPnames = {
  0x8B80, // DELETE_STATUS
  0x8B81, // COMPILE_STATUS
};
const _programStatusPnames = {
  0x8B80, // DELETE_STATUS
  0x8B82, // LINK_STATUS
  0x8B83, // VALIDATE_STATUS
};
const _programCountPnames = {
  0x8A36, // ACTIVE_UNIFORM_BLOCKS
  0x8B85, // ATTACHED_SHADERS
  0x8B86, // ACTIVE_UNIFORMS
  0x8B89, // ACTIVE_ATTRIBUTES
  0x8C83, // TRANSFORM_FEEDBACK_VARYINGS
};

/// GL's `getActiveAttrib`/`getActiveUniform` result.
class FjsActiveInfo {
  const FjsActiveInfo(this.name, this.size, this.type);
  final String name;
  final int size;
  final int type;
}

/// The GL surface the decoder drives. Handles are the JS side's u32 ids
/// (0 = null object); implementations create the underlying GL object
/// lazily on first reference, because GL object creation is what the DOM's
/// `createX()` calls mean and the JS side allocated the id.
abstract class FjsGlBindings {
  // resources
  void createBuffer(int id);
  void deleteBuffer(int id);
  void createFramebuffer(int id);
  void deleteFramebuffer(int id);
  void createProgram(int id);
  void deleteProgram(int id);
  void createRenderbuffer(int id);
  void deleteRenderbuffer(int id);
  void createShader(int id, int type);
  void deleteShader(int id);
  void createTexture(int id);
  void deleteTexture(int id);
  void createVertexArray(int id);
  void deleteVertexArray(int id);

  // binding & state
  void activeTexture(int unit);
  void bindBuffer(int target, int id);
  void bindFramebuffer(int target, int id);
  void bindRenderbuffer(int target, int id);
  void bindTexture(int target, int id);
  void bindVertexArray(int id);
  void blendColor(double r, double g, double b, double a);
  void blendEquation(int mode);
  void blendEquationSeparate(int modeRgb, int modeAlpha);
  void blendFunc(int sfactor, int dfactor);
  void blendFuncSeparate(int srcRgb, int dstRgb, int srcAlpha, int dstAlpha);
  void clearColor(double r, double g, double b, double a);
  void clearDepth(double depth);
  void clearStencil(int s);
  void colorMask(bool r, bool g, bool b, bool a);
  void cullFace(int mode);
  void depthFunc(int func);
  void depthMask(bool flag);
  void depthRange(double zNear, double zFar);
  void disable(int cap);
  void enable(int cap);
  void frontFace(int mode);
  void hint(int target, int mode);
  void lineWidth(double width);
  void pixelStorei(int pname, int param);
  void polygonOffset(double factor, double units);
  void sampleCoverage(double value, bool invert);
  void scissor(int x, int y, int width, int height);
  void stencilFunc(int func, int ref, int mask);
  void stencilFuncSeparate(int face, int func, int ref, int mask);
  void stencilMask(int mask);
  void stencilMaskSeparate(int face, int mask);
  void stencilOp(int fail, int zfail, int zpass);
  void stencilOpSeparate(int face, int fail, int zfail, int zpass);
  void viewport(int x, int y, int width, int height);

  // data upload
  void bufferData(int target, Uint8List data, int usage);
  void bufferDataSize(int target, int size, int usage);
  void bufferSubData(int target, int offset, Uint8List data);
  void texImage2D(int target, int level, int internalformat, int width,
      int height, int border, int format, int type, Uint8List pixels);
  /// The 6-arg source form: [handle] names a decoded image in the host's
  /// canvas image table (shared with 2d drawImage). [flipY] carries the
  /// UNPACK_FLIP_Y_WEBGL pixel-store state the JS side recorded for this
  /// upload — GL ES has no such pname, so the rows are flipped here.
  void texImage2DSource(int target, int level, int internalformat, int format,
      int type, int handle, bool flipY);
  void texSubImage2D(int target, int level, int xoffset, int yoffset,
      int width, int height, int format, int type, Uint8List pixels);
  /// texSubImage2D's 6-arg source form (three.js's texStorage2D + sub-upload
  /// pair, spec 023). Dimensions come from the host's cached image.
  void texSubImage2DSource(int target, int level, int xoffset, int yoffset,
      int format, int type, int handle, bool flipY);
  void texStorage2D(int target, int levels, int internalformat, int width,
      int height);
  void texImage3D(int target, int level, int internalformat, int width,
      int height, int depth, int border, int format, int type,
      Uint8List pixels);
  void texSubImage3D(int target, int level, int xoffset, int yoffset,
      int zoffset, int width, int height, int depth, int format, int type,
      Uint8List pixels);
  void texParameterf(int target, int pname, double param);
  void texParameteri(int target, int pname, int param);
  void generateMipmap(int target);

  // program
  void shaderSource(int shader, String source);
  void compileShader(int shader);
  void attachShader(int program, int shader);
  void detachShader(int program, int shader);
  void linkProgram(int program);
  void useProgram(int id);
  void validateProgram(int program);
  void bindAttribLocation(int program, int index, String name);

  // vertex
  void enableVertexAttribArray(int index);
  void disableVertexAttribArray(int index);
  void vertexAttribPointer(
      int index, int size, int type, bool normalized, int stride, int offset);
  /// WebGL2 core — three.js calls it for every enabled attribute, instanced
  /// or not (spec 023).
  void vertexAttribDivisor(int index, int divisor);
  void vertexAttrib1f(int index, double x);
  void vertexAttrib2f(int index, double x, double y);
  void vertexAttrib3f(int index, double x, double y, double z);
  void vertexAttrib4f(int index, double x, double y, double z, double w);
  void vertexAttrib1fv(int index, Float32List v);
  void vertexAttrib2fv(int index, Float32List v);
  void vertexAttrib3fv(int index, Float32List v);
  void vertexAttrib4fv(int index, Float32List v);

  // uniform
  void uniform1i(int location, int x);
  void uniform2i(int location, int x, int y);
  void uniform3i(int location, int x, int y, int z);
  void uniform4i(int location, int x, int y, int z, int w);
  void uniform1f(int location, double x);
  void uniform2f(int location, double x, double y);
  void uniform3f(int location, double x, double y, double z);
  void uniform4f(int location, double x, double y, double z, double w);
  void uniform1iv(int location, Int32List v);
  void uniform2iv(int location, Int32List v);
  void uniform3iv(int location, Int32List v);
  void uniform4iv(int location, Int32List v);
  void uniform1fv(int location, Float32List v);
  void uniform2fv(int location, Float32List v);
  void uniform3fv(int location, Float32List v);
  void uniform4fv(int location, Float32List v);
  void uniformMatrix2fv(int location, bool transpose, Float32List v);
  void uniformMatrix3fv(int location, bool transpose, Float32List v);
  void uniformMatrix4fv(int location, bool transpose, Float32List v);

  // draw
  void clear(int mask);
  void drawArrays(int mode, int first, int count);
  void drawElements(int mode, int count, int type, int offset);
  void drawArraysInstanced(int mode, int first, int count, int instanceCount);
  void drawElementsInstanced(
      int mode, int count, int type, int offset, int instanceCount);
  void finish();
  void flush();

  // framebuffer
  void framebufferTexture2D(
      int target, int attachment, int textarget, int texture, int level);
  void framebufferRenderbuffer(
      int target, int attachment, int renderbuffertarget, int renderbuffer);
  void renderbufferStorage(
      int target, int internalformat, int width, int height);

  // queries — synchronous state, answered inside the JS call (spec 021 §3.4
  // as amended: location queries are answered by [FjsWebgl.query] itself and
  // never reach here; status queries arrive only once the stream has
  // drained, or with optimistic defaults taken at the manager level).
  int getError() => 0;
  int getAttribLocation(int program, String name) => -1;
  Object? getParameter(int pname) => null;
  Object? getShaderParameter(int shader, int pname) => null;
  Object? getProgramParameter(int program, int pname) => null;
  String? getShaderInfoLog(int shader) => null;
  String? getProgramInfoLog(int program) => null;
  String? getShaderSource(int shader) => null;
  FjsActiveInfo? getActiveAttrib(int program, int index) => null;
  FjsActiveInfo? getActiveUniform(int program, int index) => null;
  Object? getUniform(int program, int location) => null;
  Object? getVertexAttrib(int index, int pname) => null;
  int? getBufferParameter(int target, int pname) => null;
  int? getFramebufferAttachmentParameter(
          int target, int attachment, int pname) =>
      null;
  int? getRenderbufferParameter(int target, int pname) => null;
  bool isBuffer(int id) => false;
  bool isTexture(int id) => false;
  bool isProgram(int id) => false;
  bool isShader(int id) => false;
  bool isFramebuffer(int id) => false;
  bool isRenderbuffer(int id) => false;
  int checkFramebufferStatus(int target) => 0;

  /// RGBA8 bytes of the current drawing buffer, bottom row first, or null
  /// when the backend cannot read back (readPixels is not page-facing;
  /// this is toDataURL's plumbing only).
  Uint8List? readPixelsRgba(int x, int y, int width, int height) => null;
}

/// One chunk's worth of GL calls. Stateless across chunks except the
/// bindings: strings are interned per chunk, so the reader's table dies
/// with it.
class WebglChunkDecoder {
  WebglChunkDecoder(this.bindings);

  final FjsGlBindings bindings;

  /// Commands the decoder does not know. An unknown id means the JS runtime
  /// is newer than this host (e.g. a WebGL2 command); skipping the command
  /// is impossible without its arity, so the chunk fails loudly rather than
  /// executing a misaligned tail (constitution V).
  void run(Uint8List chunk) {
    final r = CanvasChunkReader(chunk);
    while (!r.done) {
      final cmd = r.u16();
      if (cmd == WebglCmd.strDef) {
        r.readStrDef();
        continue;
      }
      if (cmd == WebglCmd.strDef32) {
        // same intern as readStrDef, u32 length — shader sources exceed
        // 64 KiB and a truncated u16 desyncs the stream (spec 023)
        r.readStrDef32();
        continue;
      }
      _dispatch(cmd, r);
    }
  }

  void _dispatch(int cmd, CanvasChunkReader r) {
    switch (cmd) {
      // -- resources
      case WebglCmd.createBuffer:
        return bindings.createBuffer(r.u32());
      case WebglCmd.deleteBuffer:
        return bindings.deleteBuffer(r.u32());
      case WebglCmd.createFramebuffer:
        return bindings.createFramebuffer(r.u32());
      case WebglCmd.deleteFramebuffer:
        return bindings.deleteFramebuffer(r.u32());
      case WebglCmd.createProgram:
        return bindings.createProgram(r.u32());
      case WebglCmd.deleteProgram:
        return bindings.deleteProgram(r.u32());
      case WebglCmd.createRenderbuffer:
        return bindings.createRenderbuffer(r.u32());
      case WebglCmd.deleteRenderbuffer:
        return bindings.deleteRenderbuffer(r.u32());
      case WebglCmd.createShader:
        return bindings.createShader(r.u32(), r.u32());
      case WebglCmd.deleteShader:
        return bindings.deleteShader(r.u32());
      case WebglCmd.createTexture:
        return bindings.createTexture(r.u32());
      case WebglCmd.deleteTexture:
        return bindings.deleteTexture(r.u32());

      // -- binding & state
      case WebglCmd.activeTexture:
        return bindings.activeTexture(r.u32());
      case WebglCmd.bindBuffer:
        final target = r.u32();
        final id = r.u32();
        return bindings.bindBuffer(target, id);
      case WebglCmd.bindFramebuffer:
        final target = r.u32();
        final id = r.u32();
        return bindings.bindFramebuffer(target, id);
      case WebglCmd.bindRenderbuffer:
        final target = r.u32();
        final id = r.u32();
        return bindings.bindRenderbuffer(target, id);
      case WebglCmd.bindTexture:
        final target = r.u32();
        final id = r.u32();
        return bindings.bindTexture(target, id);
      case WebglCmd.blendColor:
        return bindings.blendColor(r.f32(), r.f32(), r.f32(), r.f32());
      case WebglCmd.blendEquation:
        return bindings.blendEquation(r.u32());
      case WebglCmd.blendEquationSeparate:
        return bindings.blendEquationSeparate(r.u32(), r.u32());
      case WebglCmd.blendFunc:
        return bindings.blendFunc(r.u32(), r.u32());
      case WebglCmd.blendFuncSeparate:
        return bindings.blendFuncSeparate(r.u32(), r.u32(), r.u32(), r.u32());
      case WebglCmd.clearColor:
        return bindings.clearColor(r.f32(), r.f32(), r.f32(), r.f32());
      case WebglCmd.clearDepth:
        return bindings.clearDepth(r.f32());
      case WebglCmd.clearStencil:
        return bindings.clearStencil(r.i32());
      case WebglCmd.colorMask:
        return bindings.colorMask(
            r.u8() != 0, r.u8() != 0, r.u8() != 0, r.u8() != 0);
      case WebglCmd.cullFace:
        return bindings.cullFace(r.u32());
      case WebglCmd.depthFunc:
        return bindings.depthFunc(r.u32());
      case WebglCmd.depthMask:
        return bindings.depthMask(r.u8() != 0);
      case WebglCmd.depthRange:
        return bindings.depthRange(r.f32(), r.f32());
      case WebglCmd.disable:
        return bindings.disable(r.u32());
      case WebglCmd.enable:
        return bindings.enable(r.u32());
      case WebglCmd.frontFace:
        return bindings.frontFace(r.u32());
      case WebglCmd.hint:
        return bindings.hint(r.u32(), r.u32());
      case WebglCmd.lineWidth:
        return bindings.lineWidth(r.f32());
      case WebglCmd.pixelStorei:
        return bindings.pixelStorei(r.u32(), r.i32());
      case WebglCmd.polygonOffset:
        return bindings.polygonOffset(r.f32(), r.f32());
      case WebglCmd.sampleCoverage:
        return bindings.sampleCoverage(r.f32(), r.u8() != 0);
      case WebglCmd.scissor:
        return bindings.scissor(r.i32(), r.i32(), r.i32(), r.i32());
      case WebglCmd.stencilFunc:
        return bindings.stencilFunc(r.u32(), r.i32(), r.u32());
      case WebglCmd.stencilFuncSeparate:
        return bindings.stencilFuncSeparate(r.u32(), r.u32(), r.i32(), r.u32());
      case WebglCmd.stencilMask:
        return bindings.stencilMask(r.u32());
      case WebglCmd.stencilMaskSeparate:
        return bindings.stencilMaskSeparate(r.u32(), r.u32());
      case WebglCmd.stencilOp:
        return bindings.stencilOp(r.u32(), r.u32(), r.u32());
      case WebglCmd.stencilOpSeparate:
        return bindings.stencilOpSeparate(r.u32(), r.u32(), r.u32(), r.u32());
      case WebglCmd.viewport:
        return bindings.viewport(r.i32(), r.i32(), r.i32(), r.i32());

      // -- data upload
      case WebglCmd.bufferData:
        final target = r.u32();
        final usage = r.u32();
        final data = r.sub(r.u32());
        return bindings.bufferData(target, data, usage);
      case WebglCmd.bufferDataSize:
        final target = r.u32();
        final usage = r.u32();
        final size = r.u32();
        return bindings.bufferDataSize(target, size, usage);
      case WebglCmd.bufferSubData:
        final target = r.u32();
        final offset = r.i32();
        final data = r.sub(r.u32());
        return bindings.bufferSubData(target, offset, data);
      case WebglCmd.texImage2D:
        final target = r.u32();
        final level = r.i32();
        final internalformat = r.i32();
        final width = r.i32();
        final height = r.i32();
        final border = r.i32();
        final format = r.u32();
        final type = r.u32();
        final pixels = r.sub(r.u32());
        return bindings.texImage2D(target, level, internalformat, width,
            height, border, format, type, pixels);
      case WebglCmd.texImage2DSource:
        final target = r.u32();
        final level = r.i32();
        final internalformat = r.i32();
        final format = r.u32();
        final type = r.u32();
        final kind = r.u32();
        final handle = r.u32();
        final flipY = r.u8() != 0;
        if (kind != TexSource.imageHandle) {
          throw CanvasOpException(
              'texImage2DSource: unknown source kind $kind');
        }
        return bindings.texImage2DSource(
            target, level, internalformat, format, type, handle, flipY);
      case WebglCmd.texSubImage2D:
        final target = r.u32();
        final level = r.i32();
        final xoffset = r.i32();
        final yoffset = r.i32();
        final width = r.i32();
        final height = r.i32();
        final format = r.u32();
        final type = r.u32();
        final pixels = r.sub(r.u32());
        return bindings.texSubImage2D(target, level, xoffset, yoffset, width,
            height, format, type, pixels);
      case WebglCmd.texStorage2D:
        final target = r.u32();
        final levels = r.i32();
        final internalformat = r.i32();
        final width = r.i32();
        final height = r.i32();
        return bindings.texStorage2D(
            target, levels, internalformat, width, height);
      case WebglCmd.texSubImage2DSource:
        final target = r.u32();
        final level = r.i32();
        final xoffset = r.i32();
        final yoffset = r.i32();
        final format = r.u32();
        final type = r.u32();
        final kind = r.u32();
        final handle = r.u32();
        final flipY = r.u8() != 0;
        if (kind != TexSource.imageHandle) {
          throw CanvasOpException(
              'texSubImage2DSource: unknown source kind $kind');
        }
        return bindings.texSubImage2DSource(target, level, xoffset, yoffset,
            format, type, handle, flipY);
      case WebglCmd.texImage3D:
        final target = r.u32();
        final level = r.i32();
        final internalformat = r.i32();
        final width = r.i32();
        final height = r.i32();
        final depth = r.i32();
        final border = r.i32();
        final format = r.u32();
        final type = r.u32();
        final pixels = r.sub(r.u32());
        return bindings.texImage3D(target, level, internalformat, width,
            height, depth, border, format, type, pixels);
      case WebglCmd.texSubImage3D:
        final target = r.u32();
        final level = r.i32();
        final xoffset = r.i32();
        final yoffset = r.i32();
        final zoffset = r.i32();
        final width = r.i32();
        final height = r.i32();
        final depth = r.i32();
        final format = r.u32();
        final type = r.u32();
        final pixels = r.sub(r.u32());
        return bindings.texSubImage3D(target, level, xoffset, yoffset, zoffset,
            width, height, depth, format, type, pixels);
      case WebglCmd.texParameterf:
        return bindings.texParameterf(r.u32(), r.u32(), r.f32());
      case WebglCmd.texParameteri:
        return bindings.texParameteri(r.u32(), r.u32(), r.i32());
      case WebglCmd.generateMipmap:
        return bindings.generateMipmap(r.u32());

      // -- program
      case WebglCmd.shaderSource:
        final shader = r.u32();
        return bindings.shaderSource(shader, r.str());
      case WebglCmd.compileShader:
        return bindings.compileShader(r.u32());
      case WebglCmd.attachShader:
        final program = r.u32();
        return bindings.attachShader(program, r.u32());
      case WebglCmd.detachShader:
        final program = r.u32();
        return bindings.detachShader(program, r.u32());
      case WebglCmd.linkProgram:
        return bindings.linkProgram(r.u32());
      case WebglCmd.useProgram:
        return bindings.useProgram(r.u32());
      case WebglCmd.validateProgram:
        return bindings.validateProgram(r.u32());
      case WebglCmd.bindAttribLocation:
        final program = r.u32();
        final index = r.u32();
        return bindings.bindAttribLocation(program, index, r.str());

      // -- vertex
      case WebglCmd.enableVertexAttribArray:
        return bindings.enableVertexAttribArray(r.u32());
      case WebglCmd.disableVertexAttribArray:
        return bindings.disableVertexAttribArray(r.u32());
      case WebglCmd.vertexAttribPointer:
        return bindings.vertexAttribPointer(r.u32(), r.i32(), r.u32(),
            r.u8() != 0, r.i32(), r.i32());
      case WebglCmd.vertexAttribDivisor:
        return bindings.vertexAttribDivisor(r.u32(), r.u32());
      case WebglCmd.vertexAttrib1f:
        return bindings.vertexAttrib1f(r.u32(), r.f32());
      case WebglCmd.vertexAttrib2f:
        return bindings.vertexAttrib2f(r.u32(), r.f32(), r.f32());
      case WebglCmd.vertexAttrib3f:
        return bindings.vertexAttrib3f(r.u32(), r.f32(), r.f32(), r.f32());
      case WebglCmd.vertexAttrib4f:
        return bindings.vertexAttrib4f(
            r.u32(), r.f32(), r.f32(), r.f32(), r.f32());
      case WebglCmd.vertexAttrib1fv:
        return bindings.vertexAttrib1fv(r.u32(), _f32s(r));
      case WebglCmd.vertexAttrib2fv:
        return bindings.vertexAttrib2fv(r.u32(), _f32s(r));
      case WebglCmd.vertexAttrib3fv:
        return bindings.vertexAttrib3fv(r.u32(), _f32s(r));
      case WebglCmd.vertexAttrib4fv:
        return bindings.vertexAttrib4fv(r.u32(), _f32s(r));

      // -- uniform
      case WebglCmd.uniform1i:
        return bindings.uniform1i(r.u32(), r.i32());
      case WebglCmd.uniform2i:
        return bindings.uniform2i(r.u32(), r.i32(), r.i32());
      case WebglCmd.uniform3i:
        return bindings.uniform3i(r.u32(), r.i32(), r.i32(), r.i32());
      case WebglCmd.uniform4i:
        return bindings.uniform4i(r.u32(), r.i32(), r.i32(), r.i32(), r.i32());
      case WebglCmd.uniform1f:
        return bindings.uniform1f(r.u32(), r.f32());
      case WebglCmd.uniform2f:
        return bindings.uniform2f(r.u32(), r.f32(), r.f32());
      case WebglCmd.uniform3f:
        return bindings.uniform3f(r.u32(), r.f32(), r.f32(), r.f32());
      case WebglCmd.uniform4f:
        return bindings.uniform4f(
            r.u32(), r.f32(), r.f32(), r.f32(), r.f32());
      case WebglCmd.uniform1iv:
        return bindings.uniform1iv(r.u32(), _i32s(r));
      case WebglCmd.uniform2iv:
        return bindings.uniform2iv(r.u32(), _i32s(r));
      case WebglCmd.uniform3iv:
        return bindings.uniform3iv(r.u32(), _i32s(r));
      case WebglCmd.uniform4iv:
        return bindings.uniform4iv(r.u32(), _i32s(r));
      case WebglCmd.uniform1fv:
        return bindings.uniform1fv(r.u32(), _f32s(r));
      case WebglCmd.uniform2fv:
        return bindings.uniform2fv(r.u32(), _f32s(r));
      case WebglCmd.uniform3fv:
        return bindings.uniform3fv(r.u32(), _f32s(r));
      case WebglCmd.uniform4fv:
        return bindings.uniform4fv(r.u32(), _f32s(r));
      case WebglCmd.uniformMatrix2fv:
        return bindings.uniformMatrix2fv(r.u32(), r.u8() != 0, _f32s(r));
      case WebglCmd.uniformMatrix3fv:
        return bindings.uniformMatrix3fv(r.u32(), r.u8() != 0, _f32s(r));
      case WebglCmd.uniformMatrix4fv:
        return bindings.uniformMatrix4fv(r.u32(), r.u8() != 0, _f32s(r));

      // -- draw
      case WebglCmd.clear:
        return bindings.clear(r.u32());
      case WebglCmd.drawArrays:
        return bindings.drawArrays(r.u32(), r.i32(), r.u32());
      case WebglCmd.drawElements:
        return bindings.drawElements(r.u32(), r.u32(), r.u32(), r.i32());
      case WebglCmd.drawArraysInstanced:
        return bindings.drawArraysInstanced(
            r.u32(), r.i32(), r.u32(), r.u32());
      case WebglCmd.drawElementsInstanced:
        return bindings.drawElementsInstanced(
            r.u32(), r.u32(), r.u32(), r.i32(), r.u32());
      case WebglCmd.finish:
        return bindings.finish();
      case WebglCmd.flush:
        return bindings.flush();

      // -- framebuffer
      case WebglCmd.framebufferTexture2D:
        return bindings.framebufferTexture2D(
            r.u32(), r.u32(), r.u32(), r.u32(), r.i32());
      case WebglCmd.framebufferRenderbuffer:
        return bindings.framebufferRenderbuffer(
            r.u32(), r.u32(), r.u32(), r.u32());
      case WebglCmd.renderbufferStorage:
        return bindings.renderbufferStorage(
            r.u32(), r.u32(), r.i32(), r.i32());

      case WebglCmd.createVertexArray:
        return bindings.createVertexArray(r.u32());
      case WebglCmd.bindVertexArray:
        return bindings.bindVertexArray(r.u32());
      case WebglCmd.deleteVertexArray:
        return bindings.deleteVertexArray(r.u32());

      default:
        throw CanvasOpException('unknown webgl command 0x'
            '${cmd.toRadixString(16)} at offset ${r.offset - 2}');
    }
  }

  Float32List _f32s(CanvasChunkReader r) {
    final n = r.u32();
    final out = Float32List(n);
    for (var i = 0; i < n; i++) {
      out[i] = r.f32();
    }
    return out;
  }

  Int32List _i32s(CanvasChunkReader r) {
    final n = r.u32();
    final out = Int32List(n);
    for (var i = 0; i < n; i++) {
      out[i] = r.i32();
    }
    return out;
  }
}

/// [FjsGlBindings] over flutter_angle's RenderingContext — the only code in
/// this package that touches that plugin (spec 021 §1.1). GL objects are
/// created lazily on first reference: the JS side allocated the u32 ids, so
/// "createBuffer" arriving first and "bindBuffer" arriving first must both
/// end up with exactly one underlying GL object per id.
class FjsAngleBindings extends FjsGlBindings {
  FjsAngleBindings(this.gl, this.locationRecords);

  final RenderingContext gl;

  /// The node's handle → query records, shared with [FjsWebgl.query]; see
  /// _NodeGlState.locationHandles for why resolution is deferred.
  final Map<int, _LocationQuery> locationRecords;

  final Map<int, Buffer> buffers = {};
  final Map<int, Framebuffer> framebuffers = {};
  final Map<int, Program> programs = {};
  final Map<int, Renderbuffer> renderbuffers = {};
  final Map<int, WebGLShader> shaders = {};
  final Map<int, WebGLTexture> textures = {};
  final Map<int, VertexArrayObject> vertexArrays = {};

  /// Resolved real uniform locations, by handle. Filled on first use of the
  /// handle in an executing command — at that point the shader is compiled
  /// and linked, so the GL query means something. Attribute locations get no
  /// such table: they cross the ABI as the driver's own index (see
  /// [FjsWebgl.query]).
  final Map<int, UniformLocation?> resolvedUniforms = {};

  /// flutter_angle's desktop wrapper does not implement every WebGL call
  /// yet; warn once per method and carry on rather than drop the stream.
  final Set<String> _missing = {};
  void _unsupported(String method) {
    if (_missing.add(method)) {
      debugPrint('[fjs] gl.$method is not implemented by flutter_angle; '
          'the call is skipped. See docs/canvas-compat.md.');
    }
  }

  Buffer _buffer(int id) => buffers.putIfAbsent(id, gl.createBuffer);
  Framebuffer _framebuffer(int id) =>
      framebuffers.putIfAbsent(id, gl.createFramebuffer);
  Program _program(int id) => programs.putIfAbsent(id, gl.createProgram);
  Renderbuffer _renderbuffer(int id) =>
      renderbuffers.putIfAbsent(id, gl.createRenderbuffer);
  WebGLShader _shader(int id) {
    final s = shaders[id];
    if (s == null) {
      throw CanvasOpException(
          'webgl: shader $id used before createShader (protocol bug)');
    }
    return s;
  }

  WebGLTexture _texture(int id) => textures.putIfAbsent(id, gl.createTexture);

  VertexArrayObject _vao(int id) =>
      vertexArrays.putIfAbsent(id, gl.createVertexArray);

  /// The plugin's uniform calls demand non-null UniformLocation objects;
  /// resolve the handle's real location, or null when GL says the name does
  /// not exist (the call is then skipped, matching the DOM's no-op).
  UniformLocation? _uniform(int handle) {
    if (resolvedUniforms.containsKey(handle)) return resolvedUniforms[handle];
    final record = locationRecords[handle];
    UniformLocation? loc;
    if (record != null) {
      loc = gl.getUniformLocation(_program(record.programId), record.name);
    }
    resolvedUniforms[handle] = loc;
    return loc;
  }

  void _withUniform(int handle, void Function(UniformLocation loc) call) {
    final loc = _uniform(handle);
    if (loc != null) call(loc);
  }

  // -- resources
  @override
  void createBuffer(int id) => _buffer(id);
  @override
  void deleteBuffer(int id) {
    final b = buffers.remove(id);
    if (b != null) gl.deleteBuffer(b);
  }

  @override
  void createFramebuffer(int id) => _framebuffer(id);
  @override
  void deleteFramebuffer(int id) {
    final f = framebuffers.remove(id);
    if (f != null) gl.deleteFramebuffer(f);
  }

  @override
  void createProgram(int id) => _program(id);
  @override
  void deleteProgram(int id) {
    final p = programs.remove(id);
    if (p != null) gl.deleteProgram(p);
  }

  @override
  void createRenderbuffer(int id) => _renderbuffer(id);
  @override
  void deleteRenderbuffer(int id) {
    final rb = renderbuffers.remove(id);
    if (rb != null) gl.deleteRenderbuffer(rb);
  }

  @override
  void createShader(int id, int type) {
    shaders[id] = gl.createShader(type);
  }

  @override
  void deleteShader(int id) {
    final s = shaders.remove(id);
    if (s != null) gl.deleteShader(s);
  }

  @override
  void createTexture(int id) => _texture(id);
  @override
  void deleteTexture(int id) {
    final t = textures.remove(id);
    if (t != null) gl.deleteTexture(t);
  }

  @override
  void createVertexArray(int id) => _vao(id);
  @override
  void deleteVertexArray(int id) {
    final v = vertexArrays.remove(id);
    if (v != null) gl.deleteVertexArray(v);
  }

  // -- binding & state
  @override
  void activeTexture(int unit) => gl.activeTexture(unit);
  @override
  void bindBuffer(int target, int id) =>
      gl.bindBuffer(target, id == 0 ? null : _buffer(id));
  @override
  void bindFramebuffer(int target, int id) =>
      gl.bindFramebuffer(target, id == 0 ? null : _framebuffer(id));
  @override
  void bindRenderbuffer(int target, int id) =>
      gl.bindRenderbuffer(target, id == 0 ? null : _renderbuffer(id));
  @override
  void bindTexture(int target, int id) =>
      gl.bindTexture(target, id == 0 ? null : _texture(id));
  @override
  void bindVertexArray(int id) {
    // 0 = the DOM's null object: unbind to the default VAO. The wrapper
    // dereferences .id, so the sentinel is a zero-id object, not Dart null.
    gl.bindVertexArray(id == 0 ? VertexArrayObject(0) : _vao(id));
  }
  @override
  void blendColor(double r, double g, double b, double a) =>
      _unsupported('blendColor');
  @override
  void blendEquation(int mode) => gl.blendEquation(mode);
  @override
  void blendEquationSeparate(int modeRgb, int modeAlpha) =>
      gl.blendEquationSeparate(modeRgb, modeAlpha);
  @override
  void blendFunc(int sfactor, int dfactor) => gl.blendFunc(sfactor, dfactor);
  @override
  void blendFuncSeparate(int srcRgb, int dstRgb, int srcAlpha, int dstAlpha) =>
      gl.blendFuncSeparate(srcRgb, dstRgb, srcAlpha, dstAlpha);
  @override
  void clearColor(double r, double g, double b, double a) =>
      gl.clearColor(r, g, b, a);
  @override
  void clearDepth(double depth) => gl.clearDepth(depth);
  @override
  void clearStencil(int s) => gl.clearStencil(s);
  @override
  void colorMask(bool r, bool g, bool b, bool a) => gl.colorMask(r, g, b, a);
  @override
  void cullFace(int mode) => gl.cullFace(mode);
  @override
  void depthFunc(int func) => gl.depthFunc(func);
  @override
  void depthMask(bool flag) => gl.depthMask(flag);
  @override
  void depthRange(double zNear, double zFar) => _unsupported('depthRange');
  @override
  void disable(int cap) => gl.disable(cap);
  @override
  void enable(int cap) => gl.enable(cap);
  @override
  void frontFace(int mode) => gl.frontFace(mode);
  @override
  void hint(int target, int mode) => _unsupported('hint');
  @override
  void lineWidth(double width) => gl.lineWidth(width);
  @override
  void pixelStorei(int pname, int param) {
    // GLES rejects the WebGL-only unpack pnames with INVALID_ENUM (seen as
    // per-upload error spam on Android, spec 023): FLIP_Y rides on
    // TexImage2DSource's flag instead, PREMULTIPLY/COLORSPACE are absorbed
    // — glTF materials are non-premultiplied, so absorbing them is
    // semantically correct for this format.
    if (pname == WebGL.UNPACK_FLIP_Y_WEBGL ||
        pname == WebGL.UNPACK_PREMULTIPLY_ALPHA_WEBGL ||
        pname == WebGL.UNPACK_COLORSPACE_CONVERSION_WEBGL) {
      return;
    }
    gl.pixelStorei(pname, param);
  }
  @override
  void polygonOffset(double factor, double units) =>
      gl.polygonOffset(factor, units);
  @override
  void sampleCoverage(double value, bool invert) =>
      _unsupported('sampleCoverage');
  @override
  void scissor(int x, int y, int width, int height) =>
      gl.scissor(x, y, width, height);
  @override
  void stencilFunc(int func, int ref, int mask) =>
      gl.stencilFunc(func, ref, mask);
  @override
  void stencilFuncSeparate(int face, int func, int ref, int mask) =>
      _unsupported('stencilFuncSeparate');
  @override
  void stencilMask(int mask) => gl.stencilMask(mask);
  @override
  void stencilMaskSeparate(int face, int mask) =>
      _unsupported('stencilMaskSeparate');
  @override
  void stencilOp(int fail, int zfail, int zpass) =>
      gl.stencilOp(fail, zfail, zpass);
  @override
  void stencilOpSeparate(int face, int fail, int zfail, int zpass) =>
      _unsupported('stencilOpSeparate');
  // NOTE (spec 023, Android): the platform presents the GL framebuffer
  // bottom-up here (SurfaceTexture keeps GL's origin) while the browser and
  // the iOS IOSurface texture present top-down. A negative-height viewport
  // would mirror the output but Android GL rejects it with INVALID_VALUE,
  // so pages flip the projection instead — see gltf-viewer.vue's
  // use of fjs.platform.

  @override
  void viewport(int x, int y, int width, int height) =>
      gl.viewport(x, y, width, height);

  // -- data upload
  @override
  void bufferData(int target, Uint8List data, int usage) {
    // flutter_angle 0.4+ takes TypedData straight through to GL (0.1.x
    // wanted its own NativeArray wrapper); the bytes are copied natively.
    gl.bufferData(target, data, usage);
  }

  @override
  void bufferDataSize(int target, int size, int usage) {
    // the plugin's int path still hands the SIZE to GL as a pointer address
    // (bufferDataVoid), which glBufferData would happily read — upload
    // zeroed bytes instead
    gl.bufferData(target, Uint8List(size), usage);
  }

  @override
  void bufferSubData(int target, int offset, Uint8List data) {
    gl.bufferSubData(target, offset, data);
  }

  @override
  void texImage2D(int target, int level, int internalformat, int width,
      int height, int border, int format, int type, Uint8List pixels) {
    gl.texImage2D(target, level, internalformat, width, height, border,
        format, type, pixels);
  }

  @override
  void texImage2DSource(int target, int level, int internalformat,
      int format, int type, int handle, bool flipY) {
    // the raw bytes were cached when the host decoded the image, so the
    // upload stays synchronous with the stream: a draw following the
    // texImage2D in the same chunk sees the pixels
    final cached = FjsCanvasImages.instance.rgba(handle);
    if (cached == null) {
      debugPrint('[fjs] texImage2D: image handle $handle has no pixels '
          'yet; skipped.');
      return;
    }
    final bytes = flipY
        ? _flipRows(cached.bytes, cached.width, cached.height)
        : cached.bytes;
    gl.texImage2D(target, level, internalformat, cached.width, cached.height,
        0, format, type, bytes);
  }

  /// WebGL's UNPACK_FLIP_Y_WEBGL, done by hand: the browser flips inside
  /// texImage2D, GLES has no pname for it. Top-bottom row swap of tightly
  /// packed RGBA; the cache keeps its original order because the 2d
  /// drawImage path (top-left origin) reads it unflipped.
  static Uint8List _flipRows(Uint8List rgba, int width, int height) {
    final row = width * 4;
    final out = Uint8List(rgba.length);
    for (var y = 0; y < height; y++) {
      out.setRange(y * row, y * row + row, rgba, (height - 1 - y) * row);
    }
    return out;
  }

  @override
  void texSubImage2DSource(int target, int level, int xoffset, int yoffset,
      int format, int type, int handle, bool flipY) {
    final cached = FjsCanvasImages.instance.rgba(handle);
    if (cached == null) {
      debugPrint('[fjs] texSubImage2D: image handle $handle has no pixels '
          'yet; skipped.');
      return;
    }
    final bytes = flipY
        ? _flipRows(cached.bytes, cached.width, cached.height)
        : cached.bytes;
    gl.texSubImage2D(target, level, xoffset, yoffset, cached.width,
        cached.height, format, type, bytes);
  }

  @override
  void texStorage2D(int target, int levels, int internalformat, int width,
      int height) {
    gl.texStorage2D(target, levels, internalformat, width, height);
  }

  @override
  void texImage3D(int target, int level, int internalformat, int width,
      int height, int depth, int border, int format, int type,
      Uint8List pixels) {
    gl.texImage3D(target, level, internalformat, width, height, depth, border,
        format, type, pixels);
  }

  @override
  void texSubImage3D(int target, int level, int xoffset, int yoffset,
      int zoffset, int width, int height, int depth, int format, int type,
      Uint8List pixels) {
    gl.texSubImage3D(target, level, xoffset, yoffset, zoffset, width, height,
        depth, format, type, pixels);
  }

  @override
  void texSubImage2D(int target, int level, int xoffset, int yoffset,
      int width, int height, int format, int type, Uint8List pixels) {
    gl.texSubImage2D(
        target, level, xoffset, yoffset, width, height, format, type, pixels);
  }

  @override
  void texParameterf(int target, int pname, double param) =>
      gl.texParameterf(target, pname, param);
  @override
  void texParameteri(int target, int pname, int param) =>
      gl.texParameteri(target, pname, param);
  @override
  void generateMipmap(int target) => gl.generateMipmap(target);

  // -- program
  @override
  void shaderSource(int shader, String source) =>
      gl.shaderSource(_shader(shader), source);
  @override
  void compileShader(int shader) => gl.compileShader(_shader(shader));
  @override
  void attachShader(int program, int shader) =>
      gl.attachShader(_program(program), _shader(shader));
  @override
  void detachShader(int program, int shader) =>
      _unsupported('detachShader');
  @override
  void linkProgram(int program) => gl.linkProgram(_program(program));
  @override
  void useProgram(int id) => gl.useProgram(id == 0 ? null : _program(id));
  @override
  void validateProgram(int program) => _unsupported('validateProgram');
  @override
  void bindAttribLocation(int program, int index, String name) =>
      gl.bindAttribLocation(_program(program), index, name);

  // -- vertex
  @override
  void enableVertexAttribArray(int index) =>
      gl.enableVertexAttribArray(index);
  @override
  void disableVertexAttribArray(int index) =>
      gl.disableVertexAttribArray(index);
  @override
  void vertexAttribPointer(
      int index, int size, int type, bool normalized, int stride, int offset) {
    gl.vertexAttribPointer(
        index, size, type, normalized, stride, offset);
  }

  @override
  void vertexAttribDivisor(int index, int divisor) =>
      gl.vertexAttribDivisor(index, divisor);

  @override
  void vertexAttrib1f(int index, double x) =>
      gl.vertexAttrib1fv(index, Float32List.fromList([x]));
  @override
  void vertexAttrib2f(int index, double x, double y) =>
      gl.vertexAttrib2fv(index, Float32List.fromList([x, y]));
  @override
  void vertexAttrib3f(int index, double x, double y, double z) =>
      gl.vertexAttrib3fv(index, Float32List.fromList([x, y, z]));
  @override
  void vertexAttrib4f(int index, double x, double y, double z, double w) =>
      gl.vertexAttrib4fv(index, Float32List.fromList([x, y, z, w]));
  @override
  void vertexAttrib1fv(int index, Float32List v) =>
      gl.vertexAttrib1fv(index, v);
  @override
  void vertexAttrib2fv(int index, Float32List v) =>
      gl.vertexAttrib2fv(index, v);
  @override
  void vertexAttrib3fv(int index, Float32List v) =>
      gl.vertexAttrib3fv(index, v);
  @override
  void vertexAttrib4fv(int index, Float32List v) =>
      gl.vertexAttrib4fv(index, v);

  // -- uniform
  @override
  void uniform1i(int location, int x) =>
      _withUniform(location, (loc) => gl.uniform1i(loc, x));
  @override
  void uniform2i(int location, int x, int y) =>
      _withUniform(location, (loc) => gl.uniform2i(loc, x, y));
  @override
  void uniform3i(int location, int x, int y, int z) =>
      _unsupported('uniform3i');
  @override
  void uniform4i(int location, int x, int y, int z, int w) =>
      _unsupported('uniform4i');
  @override
  void uniform1f(int location, double x) =>
      _withUniform(location, (loc) => gl.uniform1f(loc, x));
  @override
  void uniform2f(int location, double x, double y) =>
      _withUniform(location, (loc) => gl.uniform2f(loc, x, y));
  @override
  void uniform3f(int location, double x, double y, double z) =>
      _withUniform(location, (loc) => gl.uniform3f(loc, x, y, z));
  @override
  void uniform4f(int location, double x, double y, double z, double w) =>
      _withUniform(location, (loc) => gl.uniform4f(loc, x, y, z, w));
  @override
  void uniform1iv(int location, Int32List v) =>
      _withUniform(location, (loc) => gl.uniform1iv(loc, v));
  @override
  void uniform2iv(int location, Int32List v) =>
      _withUniform(location, (loc) => gl.uniform2iv(loc, v));
  @override
  void uniform3iv(int location, Int32List v) => _unsupported('uniform3iv');
  @override
  void uniform4iv(int location, Int32List v) => _unsupported('uniform4iv');
  @override
  void uniform1fv(int location, Float32List v) =>
      _withUniform(location, (loc) => gl.uniform1fv(loc, v));
  @override
  void uniform2fv(int location, Float32List v) =>
      _withUniform(location, (loc) => gl.uniform2fv(loc, v));
  @override
  void uniform3fv(int location, Float32List v) =>
      _withUniform(location, (loc) => gl.uniform3fv(loc, v));
  @override
  void uniform4fv(int location, Float32List v) =>
      _withUniform(location, (loc) => gl.uniform4fv(loc, v));
  @override
  void uniformMatrix2fv(int location, bool transpose, Float32List v) =>
      _withUniform(location, (loc) => gl.uniformMatrix2fv(loc, transpose, v));
  @override
  void uniformMatrix3fv(int location, bool transpose, Float32List v) =>
      _withUniform(location, (loc) => gl.uniformMatrix3fv(loc, transpose, v));
  @override
  void uniformMatrix4fv(int location, bool transpose, Float32List v) =>
      _withUniform(location, (loc) => gl.uniformMatrix4fv(loc, transpose, v));

  // -- draw
  @override
  void clear(int mask) => gl.clear(mask);
  @override
  void drawArrays(int mode, int first, int count) =>
      gl.drawArrays(mode, first, count);
  @override
  void drawElements(int mode, int count, int type, int offset) =>
      gl.drawElements(mode, count, type, offset);
  @override
  void drawArraysInstanced(int mode, int first, int count, int instanceCount) =>
      gl.drawArraysInstanced(mode, first, count, instanceCount);
  @override
  void drawElementsInstanced(
          int mode, int count, int type, int offset, int instanceCount) =>
      gl.drawElementsInstanced(mode, count, type, offset, instanceCount);
  @override
  void finish() => gl.finish();
  @override
  void flush() => gl.flush();

  // -- framebuffer
  @override
  void framebufferTexture2D(
      int target, int attachment, int textarget, int texture, int level) {
    gl.framebufferTexture2D(target, attachment, textarget,
        texture == 0 ? null : _texture(texture), level);
  }

  @override
  void framebufferRenderbuffer(
      int target, int attachment, int renderbuffertarget, int renderbuffer) {
    gl.framebufferRenderbuffer(target, attachment, renderbuffertarget,
        renderbuffer == 0 ? null : _renderbuffer(renderbuffer));
  }

  @override
  void renderbufferStorage(
      int target, int internalformat, int width, int height) {
    gl.renderbufferStorage(target, internalformat, width, height);
  }

  // -- queries
  @override
  int getError() => gl.getError();

  @override
  Object? getParameter(int pname) {
    // the plugin's getParameter throws for keys it does not implement; the
    // DOM returns whatever GL says, so a null beats an exception here
    try {
      return gl.getParameter(pname);
    } catch (_) {
      return null;
    }
  }

  @override
  Object? getShaderParameter(int shader, int pname) =>
      gl.getShaderParameter(_shader(shader), pname);

  @override
  Object? getProgramParameter(int program, int pname) {
    try {
      final value = gl.getProgramParameter(_program(program), pname);
      // WebGLParameter wraps the raw value in `.id` on the desktop backend
      final inner = (value as dynamic).id;
      if (inner is bool || inner is num) return inner;
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Read-only diagnostics: a lookup that cannot be answered (unknown
  /// handle, plugin stub) answers null, which the JS side turns into the
  /// DOM's empty string. It must never throw — the DOM's queries don't, and
  /// a throw here kills the whole render loop over a diagnostic.
  @override
  String? getShaderInfoLog(int shader) {
    try {
      return gl.getShaderInfoLog(_shader(shader));
    } catch (_) {
      return null;
    }
  }

  @override
  String? getProgramInfoLog(int program) {
    try {
      return gl.getProgramInfoLog(_program(program));
    } catch (_) {
      return null;
    }
  }

  @override
  int getAttribLocation(int program, String name) {
    try {
      // ActiveInfo on the plugin's side; the index is in `.id`
      final id = gl.getAttribLocation(_program(program), name).id;
      return id is int ? id : -1;
    } catch (_) {
      return -1;
    }
  }

  @override
  String? getShaderSource(int shader) {
    try {
      // the plugin's getShaderSource takes the raw int id, not the wrapper
      return gl.getShaderSource(_shader(shader).id);
    } catch (_) {
      return null;
    }
  }

  /// Diagnostics whose failure three.js cannot survive: a null here crosses
  /// the ABI as undefined and blows up its uniform traversal. A failure is
  /// logged once (the real cause needs to be visible on a device log,
  /// constitution V) and answered with a dead entry instead — an empty-named
  /// uniform resolves to no location and three.js skips its upload.
  static bool _activeInfoFailureLogged = false;

  FjsActiveInfo _deadActiveInfo(Object error) {
    if (!_activeInfoFailureLogged) {
      _activeInfoFailureLogged = true;
      debugPrint('[fjs] fjs.webgl active-info queries failing: $error');
    }
    return const FjsActiveInfo('', 0, 0);
  }

  @override
  FjsActiveInfo? getActiveAttrib(int program, int index) {
    try {
      final info = gl.getActiveAttrib(_program(program), index);
      return FjsActiveInfo(info.name, info.size, info.type);
    } catch (e) {
      return _deadActiveInfo(e);
    }
  }

  @override
  FjsActiveInfo? getActiveUniform(int program, int index) {
    try {
      final info = gl.getActiveUniform(_program(program), index);
      return FjsActiveInfo(info.name, info.size, info.type);
    } catch (e) {
      return _deadActiveInfo(e);
    }
  }

  @override
  bool isProgram(int id) {
    final p = programs[id];
    return p != null && gl.isProgram(p);
  }

  @override
  int checkFramebufferStatus(int target) => gl.checkFramebufferStatus(target);

  @override
  Uint8List? readPixelsRgba(int x, int y, int width, int height) {
    // The destination MUST be native memory registered with flutter_angle's
    // zero-copy registry: on Android+ANGLE the plugin routes an unregistered
    // TypedData through a pooled COPY, so glReadPixels would fill the copy
    // and the Dart list would come back all zeroes.
    final scratch = ZeroCopyBuffer.createUint32(width * height);
    try {
      final view = scratch.buffer.asUint8List(
          scratch.offsetInBytes, width * height * 4);
      gl.readPixels(
          x, y, width, height, WebGL.RGBA, WebGL.UNSIGNED_BYTE, view);
      return Uint8List.fromList(view);
    } catch (_) {
      return null;
    } finally {
      ZeroCopyBuffer.free(scratch);
    }
  }

}

class _LocationQuery {
  const _LocationQuery(this.programId, this.name);
  final int programId;
  final String name;
}

/// One canvas node's presentable GL target, whichever backend made it:
/// flutter_angle everywhere it has a native half, [OhosGl] on ohos (where
/// it has none — see ohos_surface.dart).
abstract class _GlSurface {
  int get textureId;
  RenderingContext getContext();
  /// Binds this surface (and its viewport) on the one shared context.
  void activate();
  /// Hands the back buffer to the compositor.
  void present();
  /// Whether an EGL window/pbuffer surface backs this texture (log only).
  bool get hasEglSurface;
}

class _AngleSurface implements _GlSurface {
  _AngleSurface(this.angle, this.texture);
  final FlutterAngle angle;
  final FlutterAngleTexture texture;
  @override
  int get textureId => texture.textureId;
  @override
  RenderingContext getContext() => texture.getContext();
  @override
  void activate() => texture.activate();
  @override
  void present() => angle.updateTexture(texture);
  @override
  bool get hasEglSurface {
    final surface = texture.surfaceId;
    return surface != null && surface.address != 0;
  }
}

class _OhosSurface implements _GlSurface {
  _OhosSurface(this.texture);
  final OhosGlTexture texture;
  @override
  int get textureId => texture.textureId;
  @override
  RenderingContext getContext() => texture.getContext();
  @override
  void activate() => texture.activate();
  @override
  void present() => texture.present();
  @override
  bool get hasEglSurface => texture.live;
}

class _NodeGlState {
  _GlSurface? texture;
  FjsAngleBindings? bindings;
  /// [bindings] wrapped with this canvas's context-state bookkeeping — what
  /// the decoder actually drives (spec 036).
  TrackedGlBindings? tracked;
  WebglChunkDecoder? decoder;
  /// The mirror node whose chunks this state executes; set by [pump] so a
  /// sync query can drain everything delivered so far before answering.
  MirrorNode? displayNode;
  /// The backing store the texture was created for, in LOGICAL pixels, and
  /// the device ratio it was multiplied by — recreate when either changes.
  Size logicalSize = Size.zero;
  double dpr = 0;
  bool creating = false;
  /// The in-flight [FjsWebglRuntime._createTexture], shared so a pump that
  /// lands mid-creation awaits the same future instead of returning early
  /// (and then spinning a frame at a time until creation lands).
  Future<bool>? creation;
  bool failed = false;
  /// GL work has executed into the back buffer and has not been presented.
  /// See [FjsWebglRuntime.present] for why presenting is not part of [_drain].
  bool needsPresent = false;
  /// True once a `Texture` widget for this node has actually been built, so
  /// a present has a layer to land in (spec 026).
  bool layerLive = false;
  /// Whether [FjsWebglRuntime._activate] has bound this node's surface since
  /// the last present — see that method for why the binding does not survive
  /// one.
  bool boundSincePresent = false;

  /// Synchronous location handles. `getAttrib/UniformLocation` must answer
  /// inside the JS call — the DOM contract every page relies on — but the
  /// real GL locations do not exist until the stream has executed (and the
  /// shader compiled). So the query allocates an opaque handle and records
  /// what it names; the bindings resolve handle to real location lazily when
  /// the uniform/vertexAttrib command carrying it executes. Same
  /// program+name returns the same handle, like the DOM.
  final Map<String, int> locationHandles = {};
  final Map<int, _LocationQuery> locationRecords = {};
  int nextLocationHandle = 1;
}

/// Owns the node-to-GL-context lifecycle and pumps command chunks through
/// the decoder. Created lazily on the first webgl context; a page that never
/// asks for webgl never constructs a [FlutterAngle].
class FjsWebglRuntime {
  FjsWebglRuntime._();

  static final FjsWebglRuntime instance = FjsWebglRuntime._();

  FlutterAngle? _angle;
  OhosGl? _ohos;
  final Map<int, _NodeGlState> _states = {};

  /// The OpenHarmony flutter fork reports its own operatingSystem, and
  /// isAndroid is false there (same test as flutter_fjs's ffi.dart).
  static final bool isOhos = Platform.operatingSystem == 'ohos';

  /// What the plugin's ONE GL context holds right now. Every canvas node
  /// renders through the same context, so each one restores its own state
  /// against this before executing (spec 036, see gl_state.dart).
  final GlCurrentState _gl = GlCurrentState();

  /// Whether freeing a texture is allowed to release the plugin-side
  /// resources too (flutter_angle's `releaseAll`).
  ///
  /// False on the iOS simulator: that target's plugin implements
  /// disposeTexture() as `eglMakeCurrent(nil) + eglTerminate(display)`, which
  /// tears down the whole EGL display rather than one texture — and
  /// FlutterAngle.init() returns early once a display exists, so nothing ever
  /// rebuilds it. The next canvas node's createTexture then finds no ANGLE
  /// Metal device and the plugin answers with fatalError, killing the process
  /// (observed as: triangle page, back, three.js page → "Could not create
  /// Metal Device"). Leaking one FBO per disposed node beats killing the app
  /// on a dev-only target. Device iOS uses a different plugin that scopes
  /// disposeTexture() correctly, so it keeps the real release.
  /// The app bundle lives under CoreSimulator only on a simulator; the
  /// SIMULATOR_* environment is not guaranteed to reach the app process.
  static final bool _canReleasePluginTexture = !(Platform.isIOS &&
      (Platform.resolvedExecutable.contains('/CoreSimulator/') ||
          Platform.environment.keys.any((k) => k.startsWith('SIMULATOR_'))));

  bool _leakLogged = false;
  bool _presentLogged = false;

  /// Whose EGL surface / FBO is currently bound, and whether that binding
  /// was made since the last present.
  ///
  /// `FlutterAngleTexture.activate()` is an `eglMakeCurrent`, and re-binding
  /// a draw surface discards its back buffer. A JS-side query drains the
  /// command stream mid-`draw()` (getAttribLocation has to go through GL),
  /// so one page frame reaches the host as two batches — re-activating
  /// between them left the clear in a dead buffer and drew the geometry onto
  /// undefined contents (the tiled, half-drawn first frame of the glTF
  /// viewer on Android).
  ///
  /// The binding is NOT kept across presents, though: on the iOS device path
  /// `updateTexture` ends in a `textureFrameAvailable` platform call, after
  /// which the surface this side thinks is current no longer is — skipping
  /// the re-bind there rendered every later frame into nowhere and the
  /// canvas stayed empty. So: bind once per frame, never mid-frame.
  int? _activeNode;

  /// Binding the surface is not enough since spec 036: the surfaces share one
  /// GL context, so the previous canvas's enables, bindings and viewport are
  /// still live. After the surface, restore this canvas's own state — a diff
  /// against [_gl], so a canvas rendering alone pays an identity check.
  void _activate(int nodeId, _NodeGlState state) {
    if (_activeNode == nodeId && state.boundSincePresent) {
      // same surface, same frame; a query on another canvas may still have
      // synced its state in between
      state.tracked?.sync();
      return;
    }
    state.texture?.activate();
    final tracked = state.tracked;
    if (tracked != null) {
      _gl.pluginActivated(tracked.own.width, tracked.own.height);
      tracked.sync();
    }
    state.boundSincePresent = true;
    _activeNode = nodeId;
  }

  /// True when a texture took flutter_angle's IOSurface path but came back
  /// with no EGL surface to render into. On Apple the plugin picks one of
  /// two mechanisms: the simulator answers `openglTexture` (FBO path — fboId
  /// set, surfaceId legitimately null), a device answers `surfacePointer`
  /// (surface path — fboId is 0 and surfaceId must be live). Only the
  /// second combination with a dead surface is the silent-blank case.
  bool _appleDeviceSurfaceMissing(FlutterAngleTexture texture) {
    if (!Platform.isIOS && !Platform.isMacOS) return false;
    if (texture.fboId != 0) return false;
    final surface = texture.surfaceId;
    return surface == null || surface.address == 0;
  }

  Future<void> _freeTexture(_GlSurface surface) async {
    // `deleteTexture` makes the dying surface current and then destroys it,
    // and callers do not await this — so the makeCurrent can land AFTER the
    // next page's node has bound its own surface, leaving a destroyed one
    // current with nothing to say so. Forget the binding on both sides of
    // the await; [_activate] then re-binds on the next frame.
    _activeNode = null;
    if (surface is _OhosSurface) {
      final deleting = surface.texture.dispose();
      _gl.pluginTouched();
      await deleting;
      _activeNode = null;
      return;
    }
    final texture = (surface as _AngleSurface).texture;
    if (!_canReleasePluginTexture) {
      if (!_leakLogged) {
        _leakLogged = true;
        debugPrint('[fjs] webgl: leaking canvas textures on this target — '
            'the iOS simulator plugin frees a texture by terminating the '
            'whole EGL display, which kills the next context');
      }
      return;
    }
    final deleting = _angle?.deleteTexture(texture);
    // Its GL calls (framebuffer, clearColor) run before the plugin's first
    // await, and another canvas may sync while we wait: invalidate now.
    _gl.pluginTouched();
    await deleting;
    _activeNode = null;
  }

  /// Makes sure [node]'s id has a GL context sized for [size] times [dpr],
  /// then executes everything queued on node.webglChunks. Safe to call on
  /// every build: creation is deduped, a size change recreates the texture,
  /// and an empty chunk list costs one boolean check.
  Future<void> pump(MirrorNode node, Size size, double dpr) async {
    final state = _states.putIfAbsent(node.id, _NodeGlState.new);
    state.displayNode = node;
    if (state.failed) {
      // No context to execute into and none coming. Dropping the queue keeps
      // a page that renders anyway from growing it without bound.
      node.webglChunks.clear();
      return;
    }
    final needsTexture = state.texture == null ||
        state.logicalSize != size ||
        state.dpr != dpr;
    if (needsTexture) {
      // AWAITED, not fire-and-forget: the caller hangs the "texture id now
      // exists, rebuild the Texture widget" setState and the layer re-mark
      // (markFrameAvailable) off THIS future. Creation used to run in the
      // background, so pump() completed before there was a texture: the
      // setState rebuilt a still-empty view and the re-mark found no texture
      // to mark. A continuously rendering page never noticed — its next
      // chunk touches the node and rebuilds. A page that renders ON DEMAND
      // has no next chunk: its one frame was drawn, presented into a texture
      // no layer displayed, and the canvas stayed blank until a drag queued
      // more chunks. (spec 027's defer-resize is what made it bite — moving
      // the first draw past the route transition took away the rebuild storm
      // that used to paper over it.)
      state.creating = true;
      final creation =
          state.creation ??= _createTexture(state, node.id, size, dpr);
      final ok = await creation;
      // A pump that joined an in-flight creation resolves here too; both
      // clearing it and draining are idempotent.
      if (identical(state.creation, creation)) {
        state.creation = null;
        state.creating = false;
      }
      if (!ok) return;
      // Chunks that arrived while the texture was (re)building ran in order
      // the moment it existed — a page's first draw may beat the texture by
      // a frame — and anything queued since goes out now.
      _drain(node.id, state, node);
      return;
    }
    if (!state.creating && state.bindings != null) {
      _drain(node.id, state, node);
    }
  }

  Future<bool> _createTexture(
    _NodeGlState state,
    int nodeId,
    Size size,
    double dpr,
  ) async {
    final old = state.texture;
    try {
      if (isOhos) {
        return await _createOhosTexture(state, nodeId, size, dpr, old);
      }
      final angle = _angle ??= FlutterAngle();
      await angle.init();
      // A resized canvas clears its picture in the browser; a fresh texture
      // is the same semantics, not an optimization (constitution I).
      if (old != null) {
        // NOT angle.dispose(): that tears down the whole ANGLE context;
        // deleteTexture releases exactly this texture
        await _freeTexture(old);
      }
      // LOGICAL size here: the plugin scales by dpr itself when it binds
      // the FBO's viewport (activateTexture uses options.width * dpr), so
      // passing device pixels doubled the dpr and shrank the picture into
      // a corner.
      final options = AngleOptions(
        width: size.width.round(),
        height: size.height.round(),
        dpr: dpr,
        antialias: true,
        useSurfaceProducer: true,
      );
      final texture = await angle.createTexture(options);
      // the plugin bound its own texture/framebuffer and set a viewport
      _gl.pluginTouched();
      // iOS real device check (spec 026): the device plugin hands back an
      // IOSurface, and the Dart side must wrap it in an EGL pbuffer surface.
      // When that wrapping fails, flutter_angle logs one console line and
      // soldiers on with a null surface — every draw then lands on
      // framebuffer 0 with no attachment and the canvas shows nothing, with
      // no GL error anywhere. The simulator is immune (it takes the
      // openglTexture/FBO path instead), which is exactly why the device
      // blanks while the simulator renders.
      if (_appleDeviceSurfaceMissing(texture)) {
        state.failed = true;
        debugPrint('[fjs] webgl: ANGLE could not build an EGL surface from '
            'the plugin\'s IOSurface on node $nodeId — rendering would go '
            'nowhere, so the canvas stays blank. This is the flutter_angle '
            'device path (eglCreatePbufferFromClientBuffer); see the '
            'angleConsole errors above for the EGL reason.');
        return false;
      }
      // One FlutterAngle serves every canvas node, and 0.4.x binds a
      // texture's FBO / EGL surface only in activate() — without this the
      // stream would render into whichever texture was last touched (or,
      // for the very first one, into no framebuffer at all).
      texture.activate();
      _activeNode = nodeId;
      // Same pixel size the plugin's activate() uses for its viewport: the
      // WebGL default viewport and scissor for this context.
      _adopt(state, _AngleSurface(angle, texture), size, dpr,
          (options.width * dpr).toInt(), (options.height * dpr).toInt());
      return true;
    } catch (error) {
      // No ANGLE on this device / no GPU: keep the page alive and blank the
      // canvas, exactly like the 2d path does without a host (constitution
      // V — warn, never throw into the widget tree).
      state.failed = true;
      debugPrint('[fjs] webgl context creation failed on node $nodeId: '
          '$error');
      return false;
    }
  }

  /// ohos: [OhosGl] instead of flutter_angle (ohos_surface.dart). The
  /// texture is sized in DEVICE pixels here — there is no plugin-side dpr
  /// scaling to double it.
  Future<bool> _createOhosTexture(_NodeGlState state, int nodeId, Size size,
      double dpr, _GlSurface? old) async {
    final gl = _ohos ??= OhosGl();
    await gl.init();
    if (old != null) await _freeTexture(old);
    final widthPx = (size.width * dpr).round().clamp(1, 1 << 14);
    final heightPx = (size.height * dpr).round().clamp(1, 1 << 14);
    final texture = await gl.createTexture(widthPx, heightPx);
    // createTexture left the new surface current
    _activeNode = nodeId;
    _adopt(state, _OhosSurface(texture), size, dpr, widthPx, heightPx);
    return true;
  }

  /// Wires a freshly created, already-bound surface into [state].
  void _adopt(_NodeGlState state, _GlSurface surface, Size size, double dpr,
      int widthPx, int heightPx) {
    state.texture = surface;
    state.bindings =
        FjsAngleBindings(surface.getContext(), state.locationRecords);
    _gl.pluginActivated(widthPx, heightPx);
    state.tracked?.dispose();
    final tracked = TrackedGlBindings(state.bindings!, _gl,
        width: widthPx, height: heightPx);
    // A new context starts at the WebGL defaults, whatever the canvas
    // before it left behind (spec 036).
    tracked.sync();
    state.tracked = tracked;
    state.decoder = WebglChunkDecoder(tracked);
    state.logicalSize = size;
    state.dpr = dpr;
  }

  void _drain(int nodeId, _NodeGlState state, MirrorNode node) {
    if (node.webglChunks.isEmpty) return;
    final chunks = List<Uint8List>.of(node.webglChunks);
    node.webglChunks.clear();
    _activate(nodeId, state);
    try {
      for (final chunk in chunks) {
        state.decoder!.run(chunk);
      }
    } catch (error) {
      // A misaligned or unknown chunk poisons the stream — we cannot know
      // where the next command starts. And the plugin throws its own types
      // on GL failures (a failed linkProgram among them), which must not
      // crash the app from inside a Future chain: kill the node's stream
      // and warn either way (constitution V).
      state.failed = true;
      debugPrint('[fjs] webgl stream dropped on node $nodeId: $error');
      return;
    }
    // NOT presented here — see [present]. Executing and presenting are two
    // different clocks: chunks execute whenever they arrive (a JS-side query
    // can drain half a frame mid-draw), the swap happens once per Flutter
    // frame.
    state.needsPresent = true;
    _schedulePresent(nodeId);
  }

  /// Node ids with a post-frame [present] already queued.
  final Set<int> _presentScheduled = {};

  void _schedulePresent(int nodeId) {
    if (!_presentScheduled.add(nodeId)) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _presentScheduled.remove(nodeId);
      present(nodeId);
    });
    // a drain driven by a JS query happens outside the build/paint cycle;
    // without this there may be no next frame to run that callback in
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  /// Waits for the GPU to actually land this frame in the plugin's IOSurface,
  /// on the one path where nothing else does.
  ///
  /// `eglSwapBuffers` does not wait, and neither — on ANGLE's Apple backend —
  /// does `glFinish`: the compositor reads the surface while the Metal
  /// command buffer is still in flight and shows the previous contents. A
  /// `glReadPixels` DOES wait, because it cannot answer until the queue has
  /// drained. One pixel is enough, and one pixel is all we take.
  ///
  /// Spec 026 met this as an accident — a debug readback after the swap made
  /// the canvas appear — and kept the `glFinish` it thought was responsible.
  /// It is not: with only the finish, the handwritten glTF viewer rendered
  /// perfectly into a framebuffer nobody ever saw. Measured on an iPhone
  /// (iOS 26.6.1) by reading pixels immediately before the swap, while the
  /// screen showed an empty canvas: centre (174, 109, 103) — Xbot's skin —
  /// on a corner of (209, 214, 219), which is the page's own clear colour.
  /// The GL side had been correct the whole time.
  ///
  /// Scoped as narrowly as the bug: Apple only, and only the device's
  /// surface path (`fboId == 0` with a live `surfaceId`). The iOS simulator
  /// takes the FBO path and Android's SurfaceProducer synchronises itself —
  /// neither should pay a pipeline stall per frame.
  void _syncAppleSurface(FjsAngleBindings bindings, FlutterAngleTexture texture) {
    if (!Platform.isIOS && !Platform.isMacOS) return;
    if (texture.fboId != 0) return;
    final surface = texture.surfaceId;
    if (surface == null || surface.address == 0) return;
    bindings.readPixelsRgba(0, 0, 1, 1);
  }

  /// Hands the back buffer to the compositor — at most ONCE per Flutter
  /// frame, and never before a `Texture` widget for the node exists.
  ///
  /// Both halves of that sentence are bugs we shipped:
  ///
  ///  * ONCE. `FlutterAngle.updateTexture` is an `eglSwapBuffers` on the
  ///    node's window surface (Android's SurfaceProducer surface, the iOS
  ///    device's pbuffer over the plugin's IOSurface). EGL's default
  ///    swap behaviour is EGL_BUFFER_DESTROYED: after a swap the back
  ///    buffer's contents are undefined. So a second swap with no rendering
  ///    in between does not "re-present" the frame — it queues a buffer of
  ///    garbage over the good one. Spec 026's re-mark did exactly that, and
  ///    so did every JS-side query that drained mid-draw: the clear went out
  ///    in one buffer and the geometry in the next, over a stale depth
  ///    buffer. Continuously rendering pages hid it (the next real frame
  ///    landed a millisecond later); the on-demand glTF viewers showed the
  ///    stale buffer forever, which is the "blank until you drag it" bug.
  ///  * NOT BEFORE THE LAYER. The first present can land in the same
  ///    post-frame window in which the Texture widget is only just being
  ///    built, and a frame marked available with no layer to receive it is
  ///    dropped (spec 026, iOS device). [layerReady] releases it.
  ///
  /// NOT UNDER TEST. This method needs a real `FlutterAngle`, which widget
  /// tests do not have — the invariants above are verified on device, and a
  /// green `flutter test` says nothing about them (constitution V: a skipped
  /// test has to say so out loud). If you change the ordering here, re-run
  /// spec 028's T033-T035: Android with and without a SurfaceProducer fence,
  /// an iOS device, and the iOS simulator, each on a page that renders ONCE.
  void present(int nodeId) {
    final state = _states[nodeId];
    if (state == null || !state.needsPresent || !state.layerLive) return;
    final texture = state.texture;
    final bindings = state.bindings;
    if (texture == null || bindings == null) return;
    // Anything delivered since the drain that asked for this present goes
    // out in the SAME buffer. A JS-side query drains mid-`draw()`
    // (getAttribLocation has to go through GL), so the clear and the
    // geometry of one page frame reach the host as two batches; swapping
    // between them puts the clear in one buffer and the geometry on the
    // next one's undefined contents, which is what the tiled, half-drawn
    // first frame of the glTF viewer was.
    _drainIfPending(nodeId, state);
    state.needsPresent = false;
    _activate(nodeId, state);
    // Flush the Metal command buffer into the IOSurface BEFORE presenting.
    // On the iOS device path eglSwapBuffers alone does not wait for the GL
    // work: the compositor can read the surface before the draws land and
    // the frame is blank. (Found by accident — a debug glReadPixels after
    // the swap made the canvas appear, because readback forces the sync.)
    // The simulator's FBO path and Android's SurfaceProducer do not need
    // this; a finish on an empty queue is a no-op there.
    bindings.finish();
    if (texture is _AngleSurface) _syncAppleSurface(bindings, texture.texture);
    texture.present();
    // the non-surface path rebinds framebuffer 0
    _gl.pluginTouched();
    state.boundSincePresent = false;
    if (!_presentLogged) {
      _presentLogged = true;
      debugPrint('[fjs] webgl: first present on node $nodeId — textureId '
          '${texture.textureId}, eglSurface '
          '${texture.hasEglSurface ? "live" : "none(FBO path)"}');
    }
  }

  /// Answers a synchronous `fjs.webgl.*` query. Returns null when the node
  /// has no live context or the backend cannot answer; the JS side maps
  /// that to the DOM's null/false.
  ///
  /// Three answer classes (spec 021 3.4 as amended by the iOS-simulator
  /// debugging session):
  ///
  ///  * getUniformLocation allocates a handle from the node's table — no GL
  ///    needed, so it works on the very first tick, before the texture even
  ///    exists; the real location is resolved when the command that carries
  ///    the handle executes (see FjsAngleBindings._uniform). This is only
  ///    legal because the DOM's uniform location is an opaque object.
  ///    getAttribLocation is NOT: its result is an index into the driver's
  ///    attribute slots, and a library indexes its own per-attribute arrays
  ///    with it — three sizes them MAX_VERTEX_ATTRIBS, so a handle counter
  ///    past that length made every write vanish, enableVertexAttribArray
  ///    never fire, and every draw read constant attribute defaults: a
  ///    black canvas with no GL error anywhere (spec 023, Android). So it
  ///    goes through GL like any other query;
  ///  * everything else executes the node's pending chunks first (a page
  ///    checks compile status in the tick it compiled) and answers from GL;
  ///  * while the context is still building, status queries answer with
  ///    optimistic defaults — COMPILE/LINK_STATUS true, counting pnames 0,
  ///    getError 0 — so the page's standard flow proceeds; a genuinely failed
  ///    compile surfaces through ANGLE's native error logging instead of the
  ///    info log.
  Object? query(int nodeId, String method, List<Object?> args) {
    // NOT _states[nodeId] + null-guard: the first query lands before any
    // pump ran (the widget only switches to the webgl view after op 11
    // arrives, and the page queries in the same tick as getContext) — the
    // handle table and the optimistic defaults must exist anyway.
    final state = _states.putIfAbsent(nodeId, _NodeGlState.new);
    int arg(int i) => args.length > i ? (args[i] as num?)?.toInt() ?? 0 : 0;
    String argS(int i) => args.length > i ? '${args[i]}' : '';

    switch (method) {
      case 'contextReady':
        return state.bindings != null;
      case 'getUniformLocation': {
        final programId = arg(0);
        final name = argS(1);
        final key = '$programId $name';
        final existing = state.locationHandles[key];
        if (existing != null) return existing;
        final handle = state.nextLocationHandle++;
        state.locationHandles[key] = handle;
        state.locationRecords[handle] = _LocationQuery(programId, name);
        return handle;
      }
      default:
        break;
    }

    final bindings = state.bindings;
    if (bindings == null) {
      // context still building (or failed): optimistic defaults
      switch (method) {
        case 'getShaderParameter':
          // Only the status pnames are booleans. SHADER_TYPE has no honest
          // answer here, and answering `true` for it would be read as 1.
          return _shaderStatusPnames.contains(arg(1)) ? true : null;
        case 'getProgramParameter':
          // `true` is only right for the status pnames. The counting ones
          // (ACTIVE_UNIFORMS and friends) are read as numbers, and `true`
          // reads as 1 in JS — three.js then walks a one-entry uniform list
          // and dereferences the getActiveUniform(program, 0) that this
          // branch cannot answer either (spec 023, iOS simulator: "cannot
          // read property 'name' of null" inside WebGLUniforms). Nothing is
          // linked yet, so the honest count is 0.
          if (_programStatusPnames.contains(arg(1))) return true;
          return _programCountPnames.contains(arg(1)) ? 0 : null;
        case 'getActiveUniform':
        case 'getActiveAttrib':
          // Reachable only if a caller asks past the 0 count above. A dead
          // entry keeps it walking; null crashes it (see _deadActiveInfo).
          return '{"name":"","size":0,"type":0}';
        case 'getError':
          return 0;
        case 'getAttribLocation':
          // No program to ask. Answering a number here would be a lie of the
          // worst kind — the caller indexes its own arrays with it — so say
          // "cannot answer" and let the JS side pick the slot and pin it
          // down with bindAttribLocation (see context.ts).
          return null;
        case 'checkFramebufferStatus':
          return 0x8cd5; // FRAMEBUFFER_COMPLETE
        case 'getSupportedExtensions':
          return '[]';
        case 'getContextAttributes':
          return '{"alpha":true,"antialias":true,"depth":true,'
              '"desynchronized":false,"failIfMajorPerformanceCaveat":false,'
              '"powerPreference":"default","premultipliedAlpha":true,'
              '"preserveDrawingBuffer":false,"stencil":false}';
        case 'getParameter':
          // three.js reads this batch during renderer construction, before
          // the GL surface exists; null poisons its texture-unit and size
          // bookkeeping permanently (spec 023 Android: "supports only null",
          // then every texSubImage2D fails). Values are the GLES3 minimums a
          // conforming device will meet — three caches them, the real query
          // answers replace them once the surface pumps.
          switch (arg(0)) {
            case 0x0d33: // MAX_TEXTURE_SIZE
              return 4096;
            case 0x851c: // MAX_CUBE_MAP_TEXTURE_SIZE
              return 4096;
            case 0x8872: // MAX_TEXTURE_IMAGE_UNITS
              return 16;
            case 0x8b4c: // MAX_VERTEX_TEXTURE_IMAGE_UNITS
              return 16;
            case 0x8b4d: // MAX_COMBINED_TEXTURE_IMAGE_UNITS
              return 16;
            case 0x8869: // MAX_VERTEX_ATTRIBS
              return 16;
            case 0x8dfb: // MAX_VERTEX_UNIFORM_VECTORS
              return 256;
            case 0x8dfc: // MAX_VARYING_VECTORS
              return 16;
            case 0x8dfd: // MAX_FRAGMENT_UNIFORM_VECTORS
              return 64;
            case 0x8a2e: // MAX_UNIFORM_BUFFER_BINDINGS
              return 36;
            case 0x8d57: // MAX_SAMPLES
              return 4;
            default:
              return null;
          }
        default:
          return null;
      }
    }

    // the query may name state a queued chunk produces (compile, link);
    // execute everything delivered so far before reading GL
    _drainIfPending(nodeId, state);
    // Answer from THIS canvas's state. Only the context state is restored,
    // not the surface: re-binding a surface mid-frame discards its back
    // buffer (spec 028, see _activeNode).
    state.tracked?.sync();

    switch (method) {
      case 'getError':
        return bindings.getError();
      case 'getAttribLocation':
        return bindings.getAttribLocation(arg(0), argS(1));
      case 'getParameter':
        return bindings.getParameter(arg(0));
      case 'getShaderParameter':
        return bindings.getShaderParameter(arg(0), arg(1));
      case 'getProgramParameter':
        return bindings.getProgramParameter(arg(0), arg(1));
      case 'getShaderInfoLog':
        return bindings.getShaderInfoLog(arg(0));
      case 'getProgramInfoLog':
        return bindings.getProgramInfoLog(arg(0));
      case 'getShaderSource':
        return bindings.getShaderSource(arg(0));
      case 'getActiveAttrib':
        final info = bindings.getActiveAttrib(arg(0), arg(1));
        return info == null
            ? null
            : '{"name":${_json(info.name)},"size":${info.size},"type":${info.type}}';
      case 'getActiveUniform':
        final info = bindings.getActiveUniform(arg(0), arg(1));
        return info == null
            ? null
            : '{"name":${_json(info.name)},"size":${info.size},"type":${info.type}}';
      case 'getUniform':
        return bindings.getUniform(arg(0), arg(1));
      case 'getVertexAttrib':
        return bindings.getVertexAttrib(arg(0), arg(1));
      case 'getBufferParameter':
        return bindings.getBufferParameter(arg(0), arg(1));
      case 'getFramebufferAttachmentParameter':
        return bindings.getFramebufferAttachmentParameter(
            arg(0), arg(1), arg(2));
      case 'getRenderbufferParameter':
        return bindings.getRenderbufferParameter(arg(0), arg(1));
      case 'isBuffer':
        return bindings.isBuffer(arg(0));
      case 'isTexture':
        return bindings.isTexture(arg(0));
      case 'isProgram':
        return bindings.isProgram(arg(0));
      case 'isShader':
        return bindings.isShader(arg(0));
      case 'isFramebuffer':
        return bindings.isFramebuffer(arg(0));
      case 'isRenderbuffer':
        return bindings.isRenderbuffer(arg(0));
      case 'checkFramebufferStatus':
        return bindings.checkFramebufferStatus(arg(0));
      case 'getContextAttributes':
        return '{"alpha":true,"antialias":true,"depth":true,'
            '"desynchronized":false,"failIfMajorPerformanceCaveat":false,'
            '"powerPreference":"default","premultipliedAlpha":true,'
            '"preserveDrawingBuffer":false,"stencil":false}';
      case 'getSupportedExtensions':
        return '[]';
      default:
        return null;
    }
  }

  String _json(String s) =>
      '"${s.replaceAll(r'\', r'\\').replaceAll('"', r'\"')}"';

  /// The node's Texture id, or null while none exists (creation is async).
  int? textureId(int nodeId) => _states[nodeId]?.texture?.textureId;

  /// RGBA8 bytes of the node's drawing buffer, top row first (ready for an
  /// ImageDescriptor), or null when there is nothing to read. Sized from
  /// the stored backing store, so callers need no geometry.
  ({int width, int height, Uint8List rgba})? readback(int nodeId) {
    final state = _states[nodeId];
    if (state?.bindings == null || state!.texture == null) return null;
    final widthPx = (state.logicalSize.width * state.dpr).round();
    final heightPx = (state.logicalSize.height * state.dpr).round();
    if (widthPx <= 0 || heightPx <= 0) return null;
    final raw = state.bindings!.readPixelsRgba(0, 0, widthPx, heightPx);
    if (raw == null) return null;
    // GL rows are bottom-up; image codecs expect top-down.
    final stride = widthPx * 4;
    final out = Uint8List(raw.length);
    for (var y = 0; y < heightPx; y++) {
      out.setRange(
        y * stride,
        (y + 1) * stride,
        raw.sublist((heightPx - 1 - y) * stride, (heightPx - y) * stride),
      );
    }
    return (width: widthPx, height: heightPx, rgba: out);
  }

  /// The node's `Texture` widget has been built, so a present now has a
  /// layer to land in. Called from a post-frame callback by the view (spec
  /// 026); releases anything [present] had to hold back.
  void layerReady(int nodeId) {
    final state = _states[nodeId];
    if (state == null) return;
    state.layerLive = true;
    present(nodeId);
  }

  /// Frees the node's context. The texture id dies with the node, so its
  /// Texture widget will never render again.
  void disposeNode(int nodeId) {
    if (_activeNode == nodeId) _activeNode = null;
    final state = _states.remove(nodeId);
    // the hidden default VAO is this canvas's; free it and stop [_gl]
    // naming the canvas as its owner (spec 036)
    state?.tracked?.dispose();
    final texture = state?.texture;
    if (texture != null) {
      unawaited(_freeTexture(texture));
    }
  }

  void _drainIfPending(int nodeId, _NodeGlState state) {
    // the chunks live on the mirror node; the caller (host module) carries
    // no node reference, so a query-time drain only applies when the widget
    // already handed the node over via [pump]
    final node = state.displayNode;
    if (node != null && node.webglChunks.isNotEmpty) {
      _drain(nodeId, state, node);
    }
  }
}
