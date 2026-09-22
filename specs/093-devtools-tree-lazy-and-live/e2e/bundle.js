(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/.pnpm/@vue+shared@3.5.42/node_modules/@vue/shared/dist/shared.cjs.js
  var require_shared_cjs = __commonJS({
    "node_modules/.pnpm/@vue+shared@3.5.42/node_modules/@vue/shared/dist/shared.cjs.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      // @__NO_SIDE_EFFECTS__
      function makeMap(str) {
        const map = /* @__PURE__ */ Object.create(null);
        for (const key of str.split(",")) map[key] = 1;
        return (val) => val in map;
      }
      var EMPTY_OBJ = Object.freeze({});
      var EMPTY_ARR = Object.freeze([]);
      var NOOP = () => {
      };
      var NO = () => false;
      var isOn = (key) => key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && // uppercase letter
      (key.charCodeAt(2) > 122 || key.charCodeAt(2) < 97);
      var isModelListener = (key) => key.startsWith("onUpdate:");
      var extend = Object.assign;
      var remove2 = (arr, el) => {
        const i = arr.indexOf(el);
        if (i > -1) {
          arr.splice(i, 1);
        }
      };
      var hasOwnProperty = Object.prototype.hasOwnProperty;
      var hasOwn = (val, key) => hasOwnProperty.call(val, key);
      var isArray = Array.isArray;
      var isMap = (val) => toTypeString(val) === "[object Map]";
      var isSet = (val) => toTypeString(val) === "[object Set]";
      var isDate = (val) => toTypeString(val) === "[object Date]";
      var isRegExp = (val) => toTypeString(val) === "[object RegExp]";
      var isFunction = (val) => typeof val === "function";
      var isString = (val) => typeof val === "string";
      var isSymbol = (val) => typeof val === "symbol";
      var isObject = (val) => val !== null && typeof val === "object";
      var isPromise = (val) => {
        return (isObject(val) || isFunction(val)) && isFunction(val.then) && isFunction(val.catch);
      };
      var objectToString = Object.prototype.toString;
      var toTypeString = (value) => objectToString.call(value);
      var toRawType = (value) => {
        return toTypeString(value).slice(8, -1);
      };
      var isPlainObject = (val) => toTypeString(val) === "[object Object]";
      var isIntegerKey = (key) => isString(key) && key !== "NaN" && key[0] !== "-" && "" + parseInt(key, 10) === key;
      var isReservedProp = /* @__PURE__ */ makeMap(
        // the leading comma is intentional so empty string "" is also included
        ",key,ref,ref_for,ref_key,onVnodeBeforeMount,onVnodeMounted,onVnodeBeforeUpdate,onVnodeUpdated,onVnodeBeforeUnmount,onVnodeUnmounted"
      );
      var isBuiltInDirective = /* @__PURE__ */ makeMap(
        "bind,cloak,else-if,else,for,html,if,model,on,once,pre,show,slot,text,memo"
      );
      var cacheStringFunction = (fn) => {
        const cache2 = /* @__PURE__ */ Object.create(null);
        return ((str) => {
          const hit = cache2[str];
          return hit || (cache2[str] = fn(str));
        });
      };
      var camelizeRE = /-\w/g;
      var camelize3 = cacheStringFunction(
        (str) => {
          return str.replace(camelizeRE, (c) => c.slice(1).toUpperCase());
        }
      );
      var hyphenateRE = /\B([A-Z])/g;
      var hyphenate = cacheStringFunction(
        (str) => str.replace(hyphenateRE, "-$1").toLowerCase()
      );
      var capitalize = cacheStringFunction((str) => {
        return str.charAt(0).toUpperCase() + str.slice(1);
      });
      var toHandlerKey = cacheStringFunction(
        (str) => {
          const s = str ? `on${capitalize(str)}` : ``;
          return s;
        }
      );
      var hasChanged = (value, oldValue) => !Object.is(value, oldValue);
      var invokeArrayFns = (fns, ...arg) => {
        for (let i = 0; i < fns.length; i++) {
          fns[i](...arg);
        }
      };
      var def = (obj, key, value, writable = false) => {
        Object.defineProperty(obj, key, {
          configurable: true,
          enumerable: false,
          writable,
          value
        });
      };
      var looseToNumber = (val) => {
        const n = parseFloat(val);
        return isNaN(n) ? val : n;
      };
      var toNumber = (val) => {
        const n = isString(val) ? Number(val) : NaN;
        return isNaN(n) ? val : n;
      };
      var _globalThis;
      var getGlobalThis = () => {
        return _globalThis || (_globalThis = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      };
      var identRE = /^[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*$/;
      function genPropsAccessExp(name) {
        return identRE.test(name) ? `__props.${name}` : `__props[${JSON.stringify(name)}]`;
      }
      function genCacheKey(source, options) {
        return source + JSON.stringify(
          options,
          (_, val) => typeof val === "function" ? val.toString() : val
        );
      }
      var PatchFlags = {
        "TEXT": 1,
        "1": "TEXT",
        "CLASS": 2,
        "2": "CLASS",
        "STYLE": 4,
        "4": "STYLE",
        "PROPS": 8,
        "8": "PROPS",
        "FULL_PROPS": 16,
        "16": "FULL_PROPS",
        "NEED_HYDRATION": 32,
        "32": "NEED_HYDRATION",
        "STABLE_FRAGMENT": 64,
        "64": "STABLE_FRAGMENT",
        "KEYED_FRAGMENT": 128,
        "128": "KEYED_FRAGMENT",
        "UNKEYED_FRAGMENT": 256,
        "256": "UNKEYED_FRAGMENT",
        "NEED_PATCH": 512,
        "512": "NEED_PATCH",
        "DYNAMIC_SLOTS": 1024,
        "1024": "DYNAMIC_SLOTS",
        "DEV_ROOT_FRAGMENT": 2048,
        "2048": "DEV_ROOT_FRAGMENT",
        "CACHED": -1,
        "-1": "CACHED",
        "BAIL": -2,
        "-2": "BAIL"
      };
      var PatchFlagNames = {
        [1]: `TEXT`,
        [2]: `CLASS`,
        [4]: `STYLE`,
        [8]: `PROPS`,
        [16]: `FULL_PROPS`,
        [32]: `NEED_HYDRATION`,
        [64]: `STABLE_FRAGMENT`,
        [128]: `KEYED_FRAGMENT`,
        [256]: `UNKEYED_FRAGMENT`,
        [512]: `NEED_PATCH`,
        [1024]: `DYNAMIC_SLOTS`,
        [2048]: `DEV_ROOT_FRAGMENT`,
        [-1]: `CACHED`,
        [-2]: `BAIL`
      };
      var ShapeFlags = {
        "ELEMENT": 1,
        "1": "ELEMENT",
        "FUNCTIONAL_COMPONENT": 2,
        "2": "FUNCTIONAL_COMPONENT",
        "STATEFUL_COMPONENT": 4,
        "4": "STATEFUL_COMPONENT",
        "TEXT_CHILDREN": 8,
        "8": "TEXT_CHILDREN",
        "ARRAY_CHILDREN": 16,
        "16": "ARRAY_CHILDREN",
        "SLOTS_CHILDREN": 32,
        "32": "SLOTS_CHILDREN",
        "TELEPORT": 64,
        "64": "TELEPORT",
        "SUSPENSE": 128,
        "128": "SUSPENSE",
        "COMPONENT_SHOULD_KEEP_ALIVE": 256,
        "256": "COMPONENT_SHOULD_KEEP_ALIVE",
        "COMPONENT_KEPT_ALIVE": 512,
        "512": "COMPONENT_KEPT_ALIVE",
        "COMPONENT": 6,
        "6": "COMPONENT"
      };
      var SlotFlags = {
        "STABLE": 1,
        "1": "STABLE",
        "DYNAMIC": 2,
        "2": "DYNAMIC",
        "FORWARDED": 3,
        "3": "FORWARDED"
      };
      var slotFlagsText = {
        [1]: "STABLE",
        [2]: "DYNAMIC",
        [3]: "FORWARDED"
      };
      var GLOBALS_ALLOWED = "Infinity,undefined,NaN,isFinite,isNaN,parseFloat,parseInt,decodeURI,decodeURIComponent,encodeURI,encodeURIComponent,Math,Number,Date,Array,Object,Boolean,String,RegExp,Map,Set,JSON,Intl,BigInt,console,Error,Symbol";
      var isGloballyAllowed = /* @__PURE__ */ makeMap(GLOBALS_ALLOWED);
      var isGloballyWhitelisted = isGloballyAllowed;
      var range = 2;
      function generateCodeFrame(source, start = 0, end = source.length) {
        start = Math.max(0, Math.min(start, source.length));
        end = Math.max(0, Math.min(end, source.length));
        if (start > end) return "";
        let lines = source.split(/(\r?\n)/);
        const newlineSequences = lines.filter((_, idx) => idx % 2 === 1);
        lines = lines.filter((_, idx) => idx % 2 === 0);
        let count = 0;
        const res = [];
        for (let i = 0; i < lines.length; i++) {
          count += lines[i].length + (newlineSequences[i] && newlineSequences[i].length || 0);
          if (count >= start) {
            for (let j = i - range; j <= i + range || end > count; j++) {
              if (j < 0 || j >= lines.length) continue;
              const line = j + 1;
              res.push(
                `${line}${" ".repeat(Math.max(3 - String(line).length, 0))}|  ${lines[j]}`
              );
              const lineLength = lines[j].length;
              const newLineSeqLength = newlineSequences[j] && newlineSequences[j].length || 0;
              if (j === i) {
                const pad = start - (count - (lineLength + newLineSeqLength));
                const length = Math.max(
                  1,
                  end > count ? lineLength - pad : end - start
                );
                res.push(`   |  ` + " ".repeat(pad) + "^".repeat(length));
              } else if (j > i) {
                if (end > count) {
                  const length = Math.max(Math.min(end - count, lineLength), 1);
                  res.push(`   |  ` + "^".repeat(length));
                }
                count += lineLength + newLineSeqLength;
              }
            }
            break;
          }
        }
        return res.join("\n");
      }
      function normalizeStyle(value) {
        if (isArray(value)) {
          const res = {};
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            const normalized = isString(item) ? parseStringStyle(item) : normalizeStyle(item);
            if (normalized) {
              for (const key in normalized) {
                res[key] = normalized[key];
              }
            }
          }
          return res;
        } else if (isString(value) || isObject(value)) {
          return value;
        }
      }
      var listDelimiterRE = /;(?![^(]*\))/g;
      var propertyDelimiterRE = /:([^]+)/;
      var styleCommentRE = /\/\*[^]*?\*\//g;
      function parseStringStyle(cssText2) {
        const ret = {};
        cssText2.replace(styleCommentRE, "").split(listDelimiterRE).forEach((item) => {
          if (item) {
            const tmp = item.split(propertyDelimiterRE);
            tmp.length > 1 && (ret[tmp[0].trim()] = tmp[1].trim());
          }
        });
        return ret;
      }
      function stringifyStyle(styles) {
        if (!styles) return "";
        if (isString(styles)) return styles;
        let ret = "";
        for (const key in styles) {
          const value = styles[key];
          if (isString(value) || typeof value === "number") {
            const normalizedKey = key.startsWith(`--`) ? key : hyphenate(key);
            ret += `${normalizedKey}:${value};`;
          }
        }
        return ret;
      }
      function normalizeClass(value) {
        let res = "";
        if (isString(value)) {
          res = value;
        } else if (isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const normalized = normalizeClass(value[i]);
            if (normalized) {
              res += normalized + " ";
            }
          }
        } else if (isObject(value)) {
          for (const name in value) {
            if (value[name]) {
              res += name + " ";
            }
          }
        }
        return res.trim();
      }
      function normalizeProps(props) {
        if (!props) return null;
        let { class: klass, style } = props;
        if (klass && !isString(klass)) {
          props.class = normalizeClass(klass);
        }
        if (style) {
          props.style = normalizeStyle(style);
        }
        return props;
      }
      var HTML_TAGS = "html,body,base,head,link,meta,style,title,address,article,aside,footer,header,hgroup,h1,h2,h3,h4,h5,h6,nav,section,div,dd,dl,dt,figcaption,figure,picture,hr,img,li,main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,data,dfn,em,i,kbd,mark,q,rp,rt,ruby,s,samp,small,span,strong,sub,sup,time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,th,tr,button,datalist,fieldset,form,input,label,legend,meter,optgroup,option,output,progress,select,textarea,details,dialog,menu,summary,template,blockquote,iframe,tfoot";
      var SVG_TAGS = "svg,animate,animateMotion,animateTransform,circle,clipPath,color-profile,defs,desc,discard,ellipse,feBlend,feColorMatrix,feComponentTransfer,feComposite,feConvolveMatrix,feDiffuseLighting,feDisplacementMap,feDistantLight,feDropShadow,feFlood,feFuncA,feFuncB,feFuncG,feFuncR,feGaussianBlur,feImage,feMerge,feMergeNode,feMorphology,feOffset,fePointLight,feSpecularLighting,feSpotLight,feTile,feTurbulence,filter,foreignObject,g,hatch,hatchpath,image,line,linearGradient,marker,mask,mesh,meshgradient,meshpatch,meshrow,metadata,mpath,path,pattern,polygon,polyline,radialGradient,rect,set,solidcolor,stop,switch,symbol,text,textPath,title,tspan,unknown,use,view";
      var MATH_TAGS = "annotation,annotation-xml,maction,maligngroup,malignmark,math,menclose,merror,mfenced,mfrac,mfraction,mglyph,mi,mlabeledtr,mlongdiv,mmultiscripts,mn,mo,mover,mpadded,mphantom,mprescripts,mroot,mrow,ms,mscarries,mscarry,msgroup,msline,mspace,msqrt,msrow,mstack,mstyle,msub,msubsup,msup,mtable,mtd,mtext,mtr,munder,munderover,none,semantics";
      var VOID_TAGS = "area,base,br,col,embed,hr,img,input,link,meta,param,source,track,wbr";
      var isHTMLTag = /* @__PURE__ */ makeMap(HTML_TAGS);
      var isSVGTag = /* @__PURE__ */ makeMap(SVG_TAGS);
      var isMathMLTag = /* @__PURE__ */ makeMap(MATH_TAGS);
      var isVoidTag = /* @__PURE__ */ makeMap(VOID_TAGS);
      var specialBooleanAttrs = `itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly`;
      var isSpecialBooleanAttr = /* @__PURE__ */ makeMap(specialBooleanAttrs);
      var isBooleanAttr = /* @__PURE__ */ makeMap(
        specialBooleanAttrs + `,async,autofocus,autoplay,controls,default,defer,disabled,inert,loop,open,required,reversed,scoped,seamless,checked,muted,multiple,selected`
      );
      function includeBooleanAttr(value) {
        return !!value || value === "";
      }
      var unsafeAttrCharRE = /[>/="'\u0009\u000a\u000c\u000d\u0020]/;
      var attrValidationCache = {};
      function isSSRSafeAttrName(name) {
        if (attrValidationCache.hasOwnProperty(name)) {
          return attrValidationCache[name];
        }
        const isUnsafe = unsafeAttrCharRE.test(name);
        if (isUnsafe) {
          console.error(`unsafe attribute name: ${name}`);
        }
        return attrValidationCache[name] = !isUnsafe;
      }
      var propsToAttrMap = {
        acceptCharset: "accept-charset",
        className: "class",
        htmlFor: "for",
        httpEquiv: "http-equiv"
      };
      var isKnownHtmlAttr = /* @__PURE__ */ makeMap(
        `accept,accept-charset,accesskey,action,align,allow,alt,async,autocapitalize,autocomplete,autofocus,autoplay,background,bgcolor,border,buffered,capture,challenge,charset,checked,cite,class,code,codebase,color,cols,colspan,content,contenteditable,contextmenu,controls,coords,crossorigin,csp,data,datetime,decoding,default,defer,dir,dirname,disabled,download,draggable,dropzone,enctype,enterkeyhint,for,form,formaction,formenctype,formmethod,formnovalidate,formtarget,headers,height,hidden,high,href,hreflang,http-equiv,icon,id,importance,inert,integrity,ismap,itemprop,keytype,kind,label,lang,language,loading,list,loop,low,manifest,max,maxlength,minlength,media,min,multiple,muted,name,novalidate,open,optimum,pattern,ping,placeholder,poster,preload,radiogroup,readonly,referrerpolicy,rel,required,reversed,rows,rowspan,sandbox,scope,scoped,selected,shape,size,sizes,slot,span,spellcheck,src,srcdoc,srclang,srcset,start,step,style,summary,tabindex,target,title,translate,type,usemap,value,width,wrap`
      );
      var isKnownSvgAttr = /* @__PURE__ */ makeMap(
        `xmlns,accent-height,accumulate,additive,alignment-baseline,alphabetic,amplitude,arabic-form,ascent,attributeName,attributeType,azimuth,baseFrequency,baseline-shift,baseProfile,bbox,begin,bias,by,calcMode,cap-height,class,clip,clipPathUnits,clip-path,clip-rule,color,color-interpolation,color-interpolation-filters,color-profile,color-rendering,contentScriptType,contentStyleType,crossorigin,cursor,cx,cy,d,decelerate,descent,diffuseConstant,direction,display,divisor,dominant-baseline,dur,dx,dy,edgeMode,elevation,enable-background,end,exponent,fill,fill-opacity,fill-rule,filter,filterRes,filterUnits,flood-color,flood-opacity,font-family,font-size,font-size-adjust,font-stretch,font-style,font-variant,font-weight,format,from,fr,fx,fy,g1,g2,glyph-name,glyph-orientation-horizontal,glyph-orientation-vertical,glyphRef,gradientTransform,gradientUnits,hanging,height,href,hreflang,horiz-adv-x,horiz-origin-x,id,ideographic,image-rendering,in,in2,intercept,k,k1,k2,k3,k4,kernelMatrix,kernelUnitLength,kerning,keyPoints,keySplines,keyTimes,lang,lengthAdjust,letter-spacing,lighting-color,limitingConeAngle,local,marker-end,marker-mid,marker-start,markerHeight,markerUnits,markerWidth,mask,maskContentUnits,maskUnits,mathematical,max,media,method,min,mode,name,numOctaves,offset,opacity,operator,order,orient,orientation,origin,overflow,overline-position,overline-thickness,panose-1,paint-order,path,pathLength,patternContentUnits,patternTransform,patternUnits,ping,pointer-events,points,pointsAtX,pointsAtY,pointsAtZ,preserveAlpha,preserveAspectRatio,primitiveUnits,r,radius,referrerPolicy,refX,refY,rel,rendering-intent,repeatCount,repeatDur,requiredExtensions,requiredFeatures,restart,result,rotate,rx,ry,scale,seed,shape-rendering,slope,spacing,specularConstant,specularExponent,speed,spreadMethod,startOffset,stdDeviation,stemh,stemv,stitchTiles,stop-color,stop-opacity,strikethrough-position,strikethrough-thickness,string,stroke,stroke-dasharray,stroke-dashoffset,stroke-linecap,stroke-linejoin,stroke-miterlimit,stroke-opacity,stroke-width,style,surfaceScale,systemLanguage,tabindex,tableValues,target,targetX,targetY,text-anchor,text-decoration,text-rendering,textLength,to,transform,transform-origin,type,u1,u2,underline-position,underline-thickness,unicode,unicode-bidi,unicode-range,units-per-em,v-alphabetic,v-hanging,v-ideographic,v-mathematical,values,vector-effect,version,vert-adv-y,vert-origin-x,vert-origin-y,viewBox,viewTarget,visibility,width,widths,word-spacing,writing-mode,x,x-height,x1,x2,xChannelSelector,xlink:actuate,xlink:arcrole,xlink:href,xlink:role,xlink:show,xlink:title,xlink:type,xmlns:xlink,xml:base,xml:lang,xml:space,y,y1,y2,yChannelSelector,z,zoomAndPan`
      );
      var isKnownMathMLAttr = /* @__PURE__ */ makeMap(
        `accent,accentunder,actiontype,align,alignmentscope,altimg,altimg-height,altimg-valign,altimg-width,alttext,bevelled,close,columnsalign,columnlines,columnspan,denomalign,depth,dir,display,displaystyle,encoding,equalcolumns,equalrows,fence,fontstyle,fontweight,form,frame,framespacing,groupalign,height,href,id,indentalign,indentalignfirst,indentalignlast,indentshift,indentshiftfirst,indentshiftlast,indextype,justify,largetop,largeop,lquote,lspace,mathbackground,mathcolor,mathsize,mathvariant,maxsize,minlabelspacing,mode,other,overflow,position,rowalign,rowlines,rowspan,rquote,rspace,scriptlevel,scriptminsize,scriptsizemultiplier,selection,separator,separators,shift,side,src,stackalign,stretchy,subscriptshift,superscriptshift,symmetric,voffset,width,widths,xlink:href,xlink:show,xlink:type,xmlns`
      );
      function isRenderableAttrValue(value) {
        if (value == null) {
          return false;
        }
        const type = typeof value;
        return type === "string" || type === "number" || type === "boolean";
      }
      var escapeRE = /["'&<>]/;
      function escapeHtml2(string) {
        const str = "" + string;
        const match = escapeRE.exec(str);
        if (!match) {
          return str;
        }
        let html = "";
        let escaped;
        let index;
        let lastIndex = 0;
        for (index = match.index; index < str.length; index++) {
          switch (str.charCodeAt(index)) {
            case 34:
              escaped = "&quot;";
              break;
            case 38:
              escaped = "&amp;";
              break;
            case 39:
              escaped = "&#39;";
              break;
            case 60:
              escaped = "&lt;";
              break;
            case 62:
              escaped = "&gt;";
              break;
            default:
              continue;
          }
          if (lastIndex !== index) {
            html += str.slice(lastIndex, index);
          }
          lastIndex = index + 1;
          html += escaped;
        }
        return lastIndex !== index ? html + str.slice(lastIndex, index) : html;
      }
      var commentStripRE = /^(?:-?>)+|<!--|-->|--!>|<!-$/g;
      function escapeHtmlComment(src) {
        let prev;
        do {
          prev = src;
          src = src.replace(commentStripRE, "");
        } while (src !== prev);
        return src;
      }
      var cssVarNameEscapeSymbolsRE = /[ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g;
      function getEscapedCssVarName(key, doubleEscape) {
        return key.replace(
          cssVarNameEscapeSymbolsRE,
          (s) => doubleEscape ? s === '"' ? '\\\\\\"' : `\\\\${s}` : `\\${s}`
        );
      }
      function looseCompareArrays(a, b) {
        if (a.length !== b.length) return false;
        let equal = true;
        for (let i = 0; equal && i < a.length; i++) {
          equal = looseEqual(a[i], b[i]);
        }
        return equal;
      }
      function looseCompareCollections(a, b) {
        if (a.size !== b.size) return false;
        const candidates = Array.from(b);
        const matched = new Uint8Array(candidates.length);
        for (const item of a) {
          let index = -1;
          for (let i = 0; i < candidates.length; i++) {
            if (!matched[i] && looseEqual(item, candidates[i])) {
              index = i;
              break;
            }
          }
          if (index < 0) return false;
          matched[index] = 1;
        }
        return true;
      }
      function looseEqual(a, b) {
        if (a === b) return true;
        let aValidType = isDate(a);
        let bValidType = isDate(b);
        if (aValidType || bValidType) {
          return aValidType && bValidType ? a.getTime() === b.getTime() : false;
        }
        aValidType = isSymbol(a);
        bValidType = isSymbol(b);
        if (aValidType || bValidType) {
          return a === b;
        }
        aValidType = isArray(a);
        bValidType = isArray(b);
        if (aValidType || bValidType) {
          return aValidType && bValidType ? looseCompareArrays(a, b) : false;
        }
        aValidType = isObject(a);
        bValidType = isObject(b);
        if (aValidType || bValidType) {
          if (!aValidType || !bValidType) {
            return false;
          }
          aValidType = isMap(a);
          bValidType = isMap(b);
          if (aValidType || bValidType) {
            return aValidType && bValidType ? looseCompareCollections(a, b) : false;
          }
          aValidType = isSet(a);
          bValidType = isSet(b);
          if (aValidType || bValidType) {
            return aValidType && bValidType ? looseCompareCollections(a, b) : false;
          }
          const aKeysCount = Object.keys(a).length;
          const bKeysCount = Object.keys(b).length;
          if (aKeysCount !== bKeysCount) {
            return false;
          }
          for (const key in a) {
            const aHasKey = a.hasOwnProperty(key);
            const bHasKey = b.hasOwnProperty(key);
            if (aHasKey && !bHasKey || !aHasKey && bHasKey || !looseEqual(a[key], b[key])) {
              return false;
            }
          }
        }
        return String(a) === String(b);
      }
      function looseIndexOf(arr, val) {
        return arr.findIndex((item) => looseEqual(item, val));
      }
      var isRef = (val) => {
        return !!(val && val["__v_isRef"] === true);
      };
      var toDisplayString = (val) => {
        return isString(val) ? val : val == null ? "" : isArray(val) || isObject(val) && (val.toString === objectToString || !isFunction(val.toString)) ? isRef(val) ? toDisplayString(val.value) : JSON.stringify(val, replacer, 2) : String(val);
      };
      var replacer = (_key, val) => {
        if (isRef(val)) {
          return replacer(_key, val.value);
        } else if (isMap(val)) {
          return {
            [`Map(${val.size})`]: [...val.entries()].reduce(
              (entries, [key, val2], i) => {
                entries[stringifySymbol(key, i) + " =>"] = val2;
                return entries;
              },
              {}
            )
          };
        } else if (isSet(val)) {
          return {
            [`Set(${val.size})`]: [...val.values()].map((v) => stringifySymbol(v))
          };
        } else if (isSymbol(val)) {
          return stringifySymbol(val);
        } else if (isObject(val) && !isArray(val) && !isPlainObject(val)) {
          return String(val);
        }
        return val;
      };
      var stringifySymbol = (v, i = "") => {
        var _a4;
        return (
          // Symbol.description in es2019+ so we need to cast here to pass
          // the lib: es2016 check
          isSymbol(v) ? `Symbol(${(_a4 = v.description) != null ? _a4 : i})` : v
        );
      };
      function normalizeCssVarValue(value) {
        if (value == null) {
          return "initial";
        }
        if (typeof value === "string") {
          return value === "" ? " " : value;
        }
        if (typeof value !== "number" || !Number.isFinite(value)) {
          {
            console.warn(
              "[Vue warn] Invalid value used for CSS binding. Expected a string or a finite number but received:",
              value
            );
          }
        }
        return String(value);
      }
      exports.EMPTY_ARR = EMPTY_ARR;
      exports.EMPTY_OBJ = EMPTY_OBJ;
      exports.NO = NO;
      exports.NOOP = NOOP;
      exports.PatchFlagNames = PatchFlagNames;
      exports.PatchFlags = PatchFlags;
      exports.ShapeFlags = ShapeFlags;
      exports.SlotFlags = SlotFlags;
      exports.camelize = camelize3;
      exports.capitalize = capitalize;
      exports.cssVarNameEscapeSymbolsRE = cssVarNameEscapeSymbolsRE;
      exports.def = def;
      exports.escapeHtml = escapeHtml2;
      exports.escapeHtmlComment = escapeHtmlComment;
      exports.extend = extend;
      exports.genCacheKey = genCacheKey;
      exports.genPropsAccessExp = genPropsAccessExp;
      exports.generateCodeFrame = generateCodeFrame;
      exports.getEscapedCssVarName = getEscapedCssVarName;
      exports.getGlobalThis = getGlobalThis;
      exports.hasChanged = hasChanged;
      exports.hasOwn = hasOwn;
      exports.hyphenate = hyphenate;
      exports.includeBooleanAttr = includeBooleanAttr;
      exports.invokeArrayFns = invokeArrayFns;
      exports.isArray = isArray;
      exports.isBooleanAttr = isBooleanAttr;
      exports.isBuiltInDirective = isBuiltInDirective;
      exports.isDate = isDate;
      exports.isFunction = isFunction;
      exports.isGloballyAllowed = isGloballyAllowed;
      exports.isGloballyWhitelisted = isGloballyWhitelisted;
      exports.isHTMLTag = isHTMLTag;
      exports.isIntegerKey = isIntegerKey;
      exports.isKnownHtmlAttr = isKnownHtmlAttr;
      exports.isKnownMathMLAttr = isKnownMathMLAttr;
      exports.isKnownSvgAttr = isKnownSvgAttr;
      exports.isMap = isMap;
      exports.isMathMLTag = isMathMLTag;
      exports.isModelListener = isModelListener;
      exports.isObject = isObject;
      exports.isOn = isOn;
      exports.isPlainObject = isPlainObject;
      exports.isPromise = isPromise;
      exports.isRegExp = isRegExp;
      exports.isRenderableAttrValue = isRenderableAttrValue;
      exports.isReservedProp = isReservedProp;
      exports.isSSRSafeAttrName = isSSRSafeAttrName;
      exports.isSVGTag = isSVGTag;
      exports.isSet = isSet;
      exports.isSpecialBooleanAttr = isSpecialBooleanAttr;
      exports.isString = isString;
      exports.isSymbol = isSymbol;
      exports.isVoidTag = isVoidTag;
      exports.looseEqual = looseEqual;
      exports.looseIndexOf = looseIndexOf;
      exports.looseToNumber = looseToNumber;
      exports.makeMap = makeMap;
      exports.normalizeClass = normalizeClass;
      exports.normalizeCssVarValue = normalizeCssVarValue;
      exports.normalizeProps = normalizeProps;
      exports.normalizeStyle = normalizeStyle;
      exports.objectToString = objectToString;
      exports.parseStringStyle = parseStringStyle;
      exports.propsToAttrMap = propsToAttrMap;
      exports.remove = remove2;
      exports.slotFlagsText = slotFlagsText;
      exports.stringifyStyle = stringifyStyle;
      exports.toDisplayString = toDisplayString;
      exports.toHandlerKey = toHandlerKey;
      exports.toNumber = toNumber;
      exports.toRawType = toRawType;
      exports.toTypeString = toTypeString;
    }
  });

  // node_modules/.pnpm/@vue+shared@3.5.42/node_modules/@vue/shared/index.js
  var require_shared = __commonJS({
    "node_modules/.pnpm/@vue+shared@3.5.42/node_modules/@vue/shared/index.js"(exports, module) {
      "use strict";
      if (false) {
        module.exports = null;
      } else {
        module.exports = require_shared_cjs();
      }
    }
  });

  // node_modules/.pnpm/@vue+reactivity@3.5.42/node_modules/@vue/reactivity/dist/reactivity.cjs.js
  var require_reactivity_cjs = __commonJS({
    "node_modules/.pnpm/@vue+reactivity@3.5.42/node_modules/@vue/reactivity/dist/reactivity.cjs.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var shared = require_shared();
      function warn(msg, ...args) {
        console.warn(`[Vue warn] ${msg}`, ...args);
      }
      var activeEffectScope;
      var EffectScope = class {
        // TODO isolatedDeclarations "__v_skip"
        constructor(detached = false) {
          this.detached = detached;
          this._active = true;
          this._on = 0;
          this.effects = [];
          this.cleanups = [];
          this._isPaused = false;
          this._warnOnRun = true;
          this.__v_skip = true;
          if (!detached && activeEffectScope) {
            if (activeEffectScope.active) {
              this.parent = activeEffectScope;
              this.index = (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(
                this
              ) - 1;
            } else {
              this._active = false;
              this._warnOnRun = false;
            }
          }
        }
        get active() {
          return this._active;
        }
        pause() {
          if (this._active) {
            this._isPaused = true;
            let i, l;
            if (this.scopes) {
              const scopes = this.scopes.slice();
              for (i = 0, l = scopes.length; i < l; i++) {
                scopes[i].pause();
              }
            }
            for (i = 0, l = this.effects.length; i < l; i++) {
              this.effects[i].pause();
            }
          }
        }
        /**
         * Resumes the effect scope, including all child scopes and effects.
         */
        resume() {
          if (this._active) {
            if (this._isPaused) {
              this._isPaused = false;
              let i, l;
              if (this.scopes) {
                const scopes = this.scopes.slice();
                for (i = 0, l = scopes.length; i < l; i++) {
                  scopes[i].resume();
                }
              }
              const effects = this.effects.slice();
              for (i = 0, l = effects.length; i < l; i++) {
                effects[i].resume();
              }
            }
          }
        }
        run(fn) {
          if (this._active) {
            const currentEffectScope = activeEffectScope;
            try {
              activeEffectScope = this;
              return fn();
            } finally {
              activeEffectScope = currentEffectScope;
            }
          } else if (this._warnOnRun) {
            warn(`cannot run an inactive effect scope.`);
          }
        }
        /**
         * This should only be called on non-detached scopes
         * @internal
         */
        on() {
          if (++this._on === 1) {
            this.prevScope = activeEffectScope;
            activeEffectScope = this;
          }
        }
        /**
         * This should only be called on non-detached scopes
         * @internal
         */
        off() {
          if (this._on > 0 && --this._on === 0) {
            if (activeEffectScope === this) {
              activeEffectScope = this.prevScope;
            } else {
              let current = activeEffectScope;
              while (current) {
                if (current.prevScope === this) {
                  current.prevScope = this.prevScope;
                  break;
                }
                current = current.prevScope;
              }
            }
            this.prevScope = void 0;
          }
        }
        stop(fromParent) {
          if (this._active) {
            this._active = false;
            let i, l;
            for (i = 0, l = this.effects.length; i < l; i++) {
              this.effects[i].stop();
            }
            this.effects.length = 0;
            for (i = 0, l = this.cleanups.length; i < l; i++) {
              this.cleanups[i]();
            }
            this.cleanups.length = 0;
            if (this.scopes) {
              const scopes = this.scopes.slice();
              for (i = 0, l = scopes.length; i < l; i++) {
                scopes[i].stop(true);
              }
              this.scopes.length = 0;
            }
            if (!this.detached && this.parent && !fromParent) {
              const last = this.parent.scopes.pop();
              if (last && last !== this) {
                this.parent.scopes[this.index] = last;
                last.index = this.index;
              }
            }
            this.parent = void 0;
          }
        }
      };
      function effectScope(detached) {
        return new EffectScope(detached);
      }
      function getCurrentScope() {
        return activeEffectScope;
      }
      function onScopeDispose(fn, failSilently = false) {
        if (activeEffectScope) {
          activeEffectScope.cleanups.push(fn);
        } else if (!failSilently) {
          warn(
            `onScopeDispose() is called when there is no active effect scope to be associated with.`
          );
        }
      }
      var activeSub;
      var EffectFlags = {
        "ACTIVE": 1,
        "1": "ACTIVE",
        "RUNNING": 2,
        "2": "RUNNING",
        "TRACKING": 4,
        "4": "TRACKING",
        "NOTIFIED": 8,
        "8": "NOTIFIED",
        "DIRTY": 16,
        "16": "DIRTY",
        "ALLOW_RECURSE": 32,
        "32": "ALLOW_RECURSE",
        "PAUSED": 64,
        "64": "PAUSED",
        "EVALUATED": 128,
        "128": "EVALUATED"
      };
      var pausedQueueEffects = /* @__PURE__ */ new WeakSet();
      var ReactiveEffect = class {
        constructor(fn) {
          this.fn = fn;
          this.deps = void 0;
          this.depsTail = void 0;
          this.flags = 1 | 4;
          this.next = void 0;
          this.cleanup = void 0;
          this.scheduler = void 0;
          if (activeEffectScope) {
            if (activeEffectScope.active) {
              activeEffectScope.effects.push(this);
            } else {
              this.flags &= -2;
            }
          }
        }
        pause() {
          this.flags |= 64;
        }
        resume() {
          if (this.flags & 64) {
            this.flags &= -65;
            if (pausedQueueEffects.has(this)) {
              pausedQueueEffects.delete(this);
              this.trigger();
            }
          }
        }
        /**
         * @internal
         */
        notify() {
          if (this.flags & 2 && !(this.flags & 32)) {
            return;
          }
          if (!(this.flags & 8)) {
            batch(this);
          }
        }
        run() {
          if (!(this.flags & 1)) {
            return this.fn();
          }
          this.flags |= 2;
          cleanupEffect(this);
          prepareDeps(this);
          const prevEffect = activeSub;
          const prevShouldTrack = shouldTrack;
          activeSub = this;
          shouldTrack = true;
          try {
            return this.fn();
          } finally {
            if (activeSub !== this) {
              warn(
                "Active effect was not restored correctly - this is likely a Vue internal bug."
              );
            }
            cleanupDeps(this);
            activeSub = prevEffect;
            shouldTrack = prevShouldTrack;
            this.flags &= -3;
          }
        }
        stop() {
          if (this.flags & 1) {
            for (let link = this.deps; link; link = link.nextDep) {
              removeSub(link);
            }
            this.deps = this.depsTail = void 0;
            cleanupEffect(this);
            this.onStop && this.onStop();
            this.flags &= -2;
          }
        }
        trigger() {
          if (this.flags & 64) {
            pausedQueueEffects.add(this);
          } else if (this.scheduler) {
            this.scheduler();
          } else {
            this.runIfDirty();
          }
        }
        /**
         * @internal
         */
        runIfDirty() {
          if (isDirty(this)) {
            this.run();
          }
        }
        get dirty() {
          return isDirty(this);
        }
      };
      var batchDepth = 0;
      var batchedSub;
      var batchedComputed;
      function batch(sub, isComputed = false) {
        sub.flags |= 8;
        if (isComputed) {
          sub.next = batchedComputed;
          batchedComputed = sub;
          return;
        }
        sub.next = batchedSub;
        batchedSub = sub;
      }
      function startBatch() {
        batchDepth++;
      }
      function endBatch() {
        if (--batchDepth > 0) {
          return;
        }
        if (batchedComputed) {
          let e = batchedComputed;
          batchedComputed = void 0;
          while (e) {
            const next = e.next;
            e.next = void 0;
            e.flags &= -9;
            e = next;
          }
        }
        let error;
        while (batchedSub) {
          let e = batchedSub;
          batchedSub = void 0;
          while (e) {
            const next = e.next;
            e.next = void 0;
            e.flags &= -9;
            if (e.flags & 1) {
              try {
                ;
                e.trigger();
              } catch (err) {
                if (!error) error = err;
              }
            }
            e = next;
          }
        }
        if (error) throw error;
      }
      function prepareDeps(sub) {
        for (let link = sub.deps; link; link = link.nextDep) {
          link.version = -1;
          link.prevActiveLink = link.dep.activeLink;
          link.dep.activeLink = link;
        }
      }
      function cleanupDeps(sub) {
        let head;
        let tail = sub.depsTail;
        let link = tail;
        while (link) {
          const prev = link.prevDep;
          if (link.version === -1) {
            if (link === tail) tail = prev;
            removeSub(link);
            removeDep(link);
          } else {
            head = link;
          }
          link.dep.activeLink = link.prevActiveLink;
          link.prevActiveLink = void 0;
          link = prev;
        }
        sub.deps = head;
        sub.depsTail = tail;
      }
      function isDirty(sub) {
        for (let link = sub.deps; link; link = link.nextDep) {
          if (link.dep.version !== link.version || link.dep.computed && (refreshComputed(link.dep.computed) || link.dep.version !== link.version)) {
            return true;
          }
        }
        if (sub._dirty) {
          return true;
        }
        return false;
      }
      function refreshComputed(computed2) {
        if (computed2.flags & 4 && !(computed2.flags & 16)) {
          return;
        }
        computed2.flags &= -17;
        if (computed2.globalVersion === globalVersion) {
          return;
        }
        computed2.globalVersion = globalVersion;
        if (!computed2.isSSR && computed2.flags & 128 && (!computed2.deps && !computed2._dirty || !isDirty(computed2))) {
          return;
        }
        computed2.flags |= 2;
        const dep = computed2.dep;
        const prevSub = activeSub;
        const prevShouldTrack = shouldTrack;
        activeSub = computed2;
        shouldTrack = true;
        try {
          prepareDeps(computed2);
          const value = computed2.fn(computed2._value);
          if (dep.version === 0 || shared.hasChanged(value, computed2._value)) {
            computed2.flags |= 128;
            computed2._value = value;
            dep.version++;
          }
        } catch (err) {
          dep.version++;
          throw err;
        } finally {
          activeSub = prevSub;
          shouldTrack = prevShouldTrack;
          cleanupDeps(computed2);
          computed2.flags &= -3;
        }
      }
      function removeSub(link, soft = false) {
        const { dep, prevSub, nextSub } = link;
        if (prevSub) {
          prevSub.nextSub = nextSub;
          link.prevSub = void 0;
        }
        if (nextSub) {
          nextSub.prevSub = prevSub;
          link.nextSub = void 0;
        }
        if (dep.subsHead === link) {
          dep.subsHead = nextSub;
        }
        if (dep.subs === link) {
          dep.subs = prevSub;
          if (!prevSub && dep.computed) {
            dep.computed.flags &= -5;
            for (let l = dep.computed.deps; l; l = l.nextDep) {
              removeSub(l, true);
            }
          }
        }
        if (!soft && !--dep.sc && dep.map) {
          dep.map.delete(dep.key);
        }
      }
      function removeDep(link) {
        const { prevDep, nextDep } = link;
        if (prevDep) {
          prevDep.nextDep = nextDep;
          link.prevDep = void 0;
        }
        if (nextDep) {
          nextDep.prevDep = prevDep;
          link.nextDep = void 0;
        }
      }
      function effect(fn, options) {
        if (fn.effect instanceof ReactiveEffect) {
          fn = fn.effect.fn;
        }
        const e = new ReactiveEffect(fn);
        if (options) {
          shared.extend(e, options);
        }
        try {
          e.run();
        } catch (err) {
          e.stop();
          throw err;
        }
        const runner = e.run.bind(e);
        runner.effect = e;
        return runner;
      }
      function stop(runner) {
        runner.effect.stop();
      }
      var shouldTrack = true;
      var trackStack = [];
      function pauseTracking() {
        trackStack.push(shouldTrack);
        shouldTrack = false;
      }
      function enableTracking() {
        trackStack.push(shouldTrack);
        shouldTrack = true;
      }
      function resetTracking() {
        const last = trackStack.pop();
        shouldTrack = last === void 0 ? true : last;
      }
      function onEffectCleanup(fn, failSilently = false) {
        if (activeSub instanceof ReactiveEffect) {
          activeSub.cleanup = fn;
        } else if (!failSilently) {
          warn(
            `onEffectCleanup() was called when there was no active effect to associate with.`
          );
        }
      }
      function cleanupEffect(e) {
        const { cleanup } = e;
        e.cleanup = void 0;
        if (cleanup) {
          const prevSub = activeSub;
          activeSub = void 0;
          try {
            cleanup();
          } finally {
            activeSub = prevSub;
          }
        }
      }
      var globalVersion = 0;
      var Link = class {
        constructor(sub, dep) {
          this.sub = sub;
          this.dep = dep;
          this.version = dep.version;
          this.nextDep = this.prevDep = this.nextSub = this.prevSub = this.prevActiveLink = void 0;
        }
      };
      var Dep = class {
        // TODO isolatedDeclarations "__v_skip"
        constructor(computed2) {
          this.computed = computed2;
          this.version = 0;
          this.activeLink = void 0;
          this.subs = void 0;
          this.map = void 0;
          this.key = void 0;
          this.sc = 0;
          this.__v_skip = true;
          {
            this.subsHead = void 0;
          }
        }
        track(debugInfo) {
          if (!activeSub || !shouldTrack || activeSub === this.computed) {
            return;
          }
          let link = this.activeLink;
          if (link === void 0 || link.sub !== activeSub) {
            link = this.activeLink = new Link(activeSub, this);
            if (!activeSub.deps) {
              activeSub.deps = activeSub.depsTail = link;
            } else {
              link.prevDep = activeSub.depsTail;
              activeSub.depsTail.nextDep = link;
              activeSub.depsTail = link;
            }
            addSub(link);
          } else if (link.version === -1) {
            link.version = this.version;
            if (link.nextDep) {
              const next = link.nextDep;
              next.prevDep = link.prevDep;
              if (link.prevDep) {
                link.prevDep.nextDep = next;
              }
              link.prevDep = activeSub.depsTail;
              link.nextDep = void 0;
              activeSub.depsTail.nextDep = link;
              activeSub.depsTail = link;
              if (activeSub.deps === link) {
                activeSub.deps = next;
              }
            }
          }
          if (activeSub.onTrack) {
            activeSub.onTrack(
              shared.extend(
                {
                  effect: activeSub
                },
                debugInfo
              )
            );
          }
          return link;
        }
        trigger(debugInfo) {
          this.version++;
          globalVersion++;
          this.notify(debugInfo);
        }
        notify(debugInfo) {
          startBatch();
          try {
            if (true) {
              for (let head = this.subsHead; head; head = head.nextSub) {
                if (head.sub.onTrigger && !(head.sub.flags & 8)) {
                  head.sub.onTrigger(
                    shared.extend(
                      {
                        effect: head.sub
                      },
                      debugInfo
                    )
                  );
                }
              }
            }
            for (let link = this.subs; link; link = link.prevSub) {
              if (link.sub.notify()) {
                ;
                link.sub.dep.notify();
              }
            }
          } finally {
            endBatch();
          }
        }
      };
      function addSub(link) {
        link.dep.sc++;
        if (link.sub.flags & 4) {
          const computed2 = link.dep.computed;
          if (computed2 && !link.dep.subs) {
            computed2.flags |= 4 | 16;
            for (let l = computed2.deps; l; l = l.nextDep) {
              addSub(l);
            }
          }
          const currentTail = link.dep.subs;
          if (currentTail !== link) {
            link.prevSub = currentTail;
            if (currentTail) currentTail.nextSub = link;
          }
          if (link.dep.subsHead === void 0) {
            link.dep.subsHead = link;
          }
          link.dep.subs = link;
        }
      }
      var targetMap = /* @__PURE__ */ new WeakMap();
      var ITERATE_KEY = /* @__PURE__ */ Symbol(
        "Object iterate"
      );
      var MAP_KEY_ITERATE_KEY = /* @__PURE__ */ Symbol(
        "Map keys iterate"
      );
      var ARRAY_ITERATE_KEY = /* @__PURE__ */ Symbol(
        "Array iterate"
      );
      function track2(target, type, key) {
        if (shouldTrack && activeSub) {
          let depsMap = targetMap.get(target);
          if (!depsMap) {
            targetMap.set(target, depsMap = /* @__PURE__ */ new Map());
          }
          let dep = depsMap.get(key);
          if (!dep) {
            depsMap.set(key, dep = new Dep());
            dep.map = depsMap;
            dep.key = key;
          }
          {
            dep.track({
              target,
              type,
              key
            });
          }
        }
      }
      function trigger(target, type, key, newValue, oldValue, oldTarget) {
        const depsMap = targetMap.get(target);
        if (!depsMap) {
          globalVersion++;
          return;
        }
        const run = (dep) => {
          if (dep) {
            {
              dep.trigger({
                target,
                type,
                key,
                newValue,
                oldValue,
                oldTarget
              });
            }
          }
        };
        startBatch();
        if (type === "clear") {
          depsMap.forEach(run);
        } else {
          const targetIsArray = shared.isArray(target);
          const isArrayIndex = targetIsArray && shared.isIntegerKey(key);
          if (targetIsArray && key === "length") {
            const newLength = Number(newValue);
            depsMap.forEach((dep, key2) => {
              if (key2 === "length" || key2 === ARRAY_ITERATE_KEY || !shared.isSymbol(key2) && key2 >= newLength) {
                run(dep);
              }
            });
          } else {
            if (key !== void 0 || depsMap.has(void 0)) {
              run(depsMap.get(key));
            }
            if (isArrayIndex) {
              run(depsMap.get(ARRAY_ITERATE_KEY));
            }
            switch (type) {
              case "add":
                if (!targetIsArray) {
                  run(depsMap.get(ITERATE_KEY));
                  if (shared.isMap(target)) {
                    run(depsMap.get(MAP_KEY_ITERATE_KEY));
                  }
                } else if (isArrayIndex) {
                  run(depsMap.get("length"));
                }
                break;
              case "delete":
                if (!targetIsArray) {
                  run(depsMap.get(ITERATE_KEY));
                  if (shared.isMap(target)) {
                    run(depsMap.get(MAP_KEY_ITERATE_KEY));
                  }
                }
                break;
              case "set":
                if (shared.isMap(target)) {
                  run(depsMap.get(ITERATE_KEY));
                }
                break;
            }
          }
        }
        endBatch();
      }
      function getDepFromReactive(object, key) {
        const depMap = targetMap.get(object);
        return depMap && depMap.get(key);
      }
      function reactiveReadArray(array) {
        const raw = /* @__PURE__ */ toRaw(array);
        if (raw === array) return raw;
        track2(raw, "iterate", ARRAY_ITERATE_KEY);
        return /* @__PURE__ */ isShallow(array) ? raw : raw.map(toReactive);
      }
      function shallowReadArray(arr) {
        track2(arr = /* @__PURE__ */ toRaw(arr), "iterate", ARRAY_ITERATE_KEY);
        return arr;
      }
      function toWrapped(target, item) {
        if (/* @__PURE__ */ isReadonly(target)) {
          return /* @__PURE__ */ isReactive(target) ? toReadonly(toReactive(item)) : toReadonly(item);
        }
        return toReactive(item);
      }
      var arrayInstrumentations = {
        __proto__: null,
        [Symbol.iterator]() {
          return iterator(this, Symbol.iterator, (item) => toWrapped(this, item));
        },
        concat(...args) {
          return reactiveReadArray(this).concat(
            ...args.map((x) => shared.isArray(x) ? reactiveReadArray(x) : x)
          );
        },
        entries() {
          return iterator(this, "entries", (value) => {
            value[1] = toWrapped(this, value[1]);
            return value;
          });
        },
        every(fn, thisArg) {
          return apply(this, "every", fn, thisArg, void 0, arguments);
        },
        filter(fn, thisArg) {
          return apply(
            this,
            "filter",
            fn,
            thisArg,
            (v) => v.map((item) => toWrapped(this, item)),
            arguments
          );
        },
        find(fn, thisArg) {
          return apply(
            this,
            "find",
            fn,
            thisArg,
            (item) => toWrapped(this, item),
            arguments
          );
        },
        findIndex(fn, thisArg) {
          return apply(this, "findIndex", fn, thisArg, void 0, arguments);
        },
        findLast(fn, thisArg) {
          return apply(
            this,
            "findLast",
            fn,
            thisArg,
            (item) => toWrapped(this, item),
            arguments
          );
        },
        findLastIndex(fn, thisArg) {
          return apply(this, "findLastIndex", fn, thisArg, void 0, arguments);
        },
        // flat, flatMap could benefit from ARRAY_ITERATE but are not straight-forward to implement
        forEach(fn, thisArg) {
          return apply(this, "forEach", fn, thisArg, void 0, arguments);
        },
        includes(...args) {
          return searchProxy(this, "includes", args);
        },
        indexOf(...args) {
          return searchProxy(this, "indexOf", args);
        },
        join(separator) {
          return reactiveReadArray(this).join(separator);
        },
        // keys() iterator only reads `length`, no optimization required
        lastIndexOf(...args) {
          return searchProxy(this, "lastIndexOf", args);
        },
        map(fn, thisArg) {
          return apply(this, "map", fn, thisArg, void 0, arguments);
        },
        pop() {
          return noTracking(this, "pop");
        },
        push(...args) {
          return noTracking(this, "push", args);
        },
        reduce(fn, ...args) {
          return reduce(this, "reduce", fn, args);
        },
        reduceRight(fn, ...args) {
          return reduce(this, "reduceRight", fn, args);
        },
        shift() {
          return noTracking(this, "shift");
        },
        // slice could use ARRAY_ITERATE but also seems to beg for range tracking
        some(fn, thisArg) {
          return apply(this, "some", fn, thisArg, void 0, arguments);
        },
        splice(...args) {
          return noTracking(this, "splice", args);
        },
        toReversed() {
          return reactiveReadArray(this).toReversed();
        },
        toSorted(comparer) {
          return reactiveReadArray(this).toSorted(comparer);
        },
        toSpliced(...args) {
          return reactiveReadArray(this).toSpliced(...args);
        },
        unshift(...args) {
          return noTracking(this, "unshift", args);
        },
        values() {
          return iterator(this, "values", (item) => toWrapped(this, item));
        }
      };
      function iterator(self2, method, wrapValue) {
        const arr = shallowReadArray(self2);
        const iter = arr[method]();
        if (arr !== self2 && !/* @__PURE__ */ isShallow(self2)) {
          iter._next = iter.next;
          iter.next = () => {
            const result = iter._next();
            if (!result.done) {
              result.value = wrapValue(result.value);
            }
            return result;
          };
        }
        return iter;
      }
      var arrayProto = Array.prototype;
      function apply(self2, method, fn, thisArg, wrappedRetFn, args) {
        const arr = shallowReadArray(self2);
        const needsWrap = arr !== self2 && !/* @__PURE__ */ isShallow(self2);
        const methodFn = arr[method];
        if (methodFn !== arrayProto[method]) {
          const result2 = methodFn.apply(self2, args);
          return needsWrap ? toReactive(result2) : result2;
        }
        let wrappedFn = fn;
        if (arr !== self2) {
          if (needsWrap) {
            wrappedFn = function(item, index) {
              return fn.call(this, toWrapped(self2, item), index, self2);
            };
          } else if (fn.length > 2) {
            wrappedFn = function(item, index) {
              return fn.call(this, item, index, self2);
            };
          }
        }
        const result = methodFn.call(arr, wrappedFn, thisArg);
        return needsWrap && wrappedRetFn ? wrappedRetFn(result) : result;
      }
      function reduce(self2, method, fn, args) {
        const arr = shallowReadArray(self2);
        const needsWrap = arr !== self2 && !/* @__PURE__ */ isShallow(self2);
        let wrappedFn = fn;
        let wrapInitialAccumulator = false;
        if (arr !== self2) {
          if (needsWrap) {
            wrapInitialAccumulator = args.length === 0;
            wrappedFn = function(acc, item, index) {
              if (wrapInitialAccumulator) {
                wrapInitialAccumulator = false;
                acc = toWrapped(self2, acc);
              }
              return fn.call(this, acc, toWrapped(self2, item), index, self2);
            };
          } else if (fn.length > 3) {
            wrappedFn = function(acc, item, index) {
              return fn.call(this, acc, item, index, self2);
            };
          }
        }
        const result = arr[method](wrappedFn, ...args);
        return wrapInitialAccumulator ? toWrapped(self2, result) : result;
      }
      function searchProxy(self2, method, args) {
        const arr = /* @__PURE__ */ toRaw(self2);
        track2(arr, "iterate", ARRAY_ITERATE_KEY);
        const res = arr[method](...args);
        if ((res === -1 || res === false) && /* @__PURE__ */ isProxy(args[0])) {
          args[0] = /* @__PURE__ */ toRaw(args[0]);
          return arr[method](...args);
        }
        return res;
      }
      function noTracking(self2, method, args = []) {
        pauseTracking();
        startBatch();
        const res = (/* @__PURE__ */ toRaw(self2))[method].apply(self2, args);
        endBatch();
        resetTracking();
        return res;
      }
      var isNonTrackableKeys = /* @__PURE__ */ shared.makeMap(`__proto__,__v_isRef,__isVue`);
      var builtInSymbols = new Set(
        /* @__PURE__ */ Object.getOwnPropertyNames(Symbol).filter((key) => key !== "arguments" && key !== "caller").map((key) => Symbol[key]).filter(shared.isSymbol)
      );
      function hasOwnProperty(key) {
        if (!shared.isSymbol(key)) key = String(key);
        const obj = /* @__PURE__ */ toRaw(this);
        track2(obj, "has", key);
        return obj.hasOwnProperty(key);
      }
      var BaseReactiveHandler = class {
        constructor(_isReadonly = false, _isShallow = false) {
          this._isReadonly = _isReadonly;
          this._isShallow = _isShallow;
        }
        get(target, key, receiver) {
          if (key === "__v_skip") return target["__v_skip"];
          const isReadonly2 = this._isReadonly, isShallow2 = this._isShallow;
          if (key === "__v_isReactive") {
            return !isReadonly2;
          } else if (key === "__v_isReadonly") {
            return isReadonly2;
          } else if (key === "__v_isShallow") {
            return isShallow2;
          } else if (key === "__v_raw") {
            if (receiver === (isReadonly2 ? isShallow2 ? shallowReadonlyMap : readonlyMap : isShallow2 ? shallowReactiveMap : reactiveMap).get(target) || // receiver is not the reactive proxy, but has the same prototype
            // this means the receiver is a user proxy of the reactive proxy
            Object.getPrototypeOf(target) === Object.getPrototypeOf(receiver)) {
              return target;
            }
            return;
          }
          const targetIsArray = shared.isArray(target);
          if (!isReadonly2) {
            let fn;
            if (targetIsArray && (fn = arrayInstrumentations[key])) {
              return fn;
            }
            if (key === "hasOwnProperty") {
              return hasOwnProperty;
            }
          }
          const res = Reflect.get(
            target,
            key,
            // if this is a proxy wrapping a ref, return methods using the raw ref
            // as receiver so that we don't have to call `toRaw` on the ref in all
            // its class methods
            /* @__PURE__ */ isRef(target) ? target : receiver
          );
          if (shared.isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
            return res;
          }
          if (!isReadonly2) {
            track2(target, "get", key);
          }
          if (isShallow2) {
            return res;
          }
          if (/* @__PURE__ */ isRef(res)) {
            const value = targetIsArray && shared.isIntegerKey(key) ? res : res.value;
            return isReadonly2 && shared.isObject(value) ? /* @__PURE__ */ readonly(value) : value;
          }
          if (shared.isObject(res)) {
            return isReadonly2 ? /* @__PURE__ */ readonly(res) : /* @__PURE__ */ reactive(res);
          }
          return res;
        }
      };
      var MutableReactiveHandler = class extends BaseReactiveHandler {
        constructor(isShallow2 = false) {
          super(false, isShallow2);
        }
        set(target, key, value, receiver) {
          let oldValue = target[key];
          const isArrayWithIntegerKey = shared.isArray(target) && shared.isIntegerKey(key);
          if (!this._isShallow) {
            const isOldValueReadonly = /* @__PURE__ */ isReadonly(oldValue);
            if (!/* @__PURE__ */ isShallow(value) && !/* @__PURE__ */ isReadonly(value)) {
              oldValue = /* @__PURE__ */ toRaw(oldValue);
              value = /* @__PURE__ */ toRaw(value);
            }
            if (!isArrayWithIntegerKey && /* @__PURE__ */ isRef(oldValue) && !/* @__PURE__ */ isRef(value)) {
              if (isOldValueReadonly) {
                {
                  warn(
                    `Set operation on key "${String(key)}" failed: target is readonly.`,
                    target[key]
                  );
                }
                return true;
              } else {
                oldValue.value = value;
                return true;
              }
            }
          }
          const hadKey = isArrayWithIntegerKey ? Number(key) < target.length : shared.hasOwn(target, key);
          const result = Reflect.set(
            target,
            key,
            value,
            /* @__PURE__ */ isRef(target) ? target : receiver
          );
          if (target === /* @__PURE__ */ toRaw(receiver) && result) {
            if (!hadKey) {
              trigger(target, "add", key, value);
            } else if (shared.hasChanged(value, oldValue)) {
              trigger(target, "set", key, value, oldValue);
            }
          }
          return result;
        }
        deleteProperty(target, key) {
          const hadKey = shared.hasOwn(target, key);
          const oldValue = target[key];
          const result = Reflect.deleteProperty(target, key);
          if (result && hadKey) {
            trigger(target, "delete", key, void 0, oldValue);
          }
          return result;
        }
        has(target, key) {
          const result = Reflect.has(target, key);
          if (!shared.isSymbol(key) || !builtInSymbols.has(key)) {
            track2(target, "has", key);
          }
          return result;
        }
        ownKeys(target) {
          track2(
            target,
            "iterate",
            shared.isArray(target) ? "length" : ITERATE_KEY
          );
          return Reflect.ownKeys(target);
        }
      };
      var ReadonlyReactiveHandler = class extends BaseReactiveHandler {
        constructor(isShallow2 = false) {
          super(true, isShallow2);
        }
        set(target, key) {
          {
            warn(
              `Set operation on key "${String(key)}" failed: target is readonly.`,
              target
            );
          }
          return true;
        }
        deleteProperty(target, key) {
          {
            warn(
              `Delete operation on key "${String(key)}" failed: target is readonly.`,
              target
            );
          }
          return true;
        }
      };
      var mutableHandlers = /* @__PURE__ */ new MutableReactiveHandler();
      var readonlyHandlers = /* @__PURE__ */ new ReadonlyReactiveHandler();
      var shallowReactiveHandlers = /* @__PURE__ */ new MutableReactiveHandler(true);
      var shallowReadonlyHandlers = /* @__PURE__ */ new ReadonlyReactiveHandler(true);
      var toShallow = (value) => value;
      var getProto = (v) => Reflect.getPrototypeOf(v);
      function createIterableMethod(method, isReadonly2, isShallow2) {
        return function(...args) {
          const target = this["__v_raw"];
          const rawTarget = /* @__PURE__ */ toRaw(target);
          const targetIsMap = shared.isMap(rawTarget);
          const isPair = method === "entries" || method === Symbol.iterator && targetIsMap;
          const isKeyOnly = method === "keys" && targetIsMap;
          const innerIterator = target[method](...args);
          const wrap = isShallow2 ? toShallow : isReadonly2 ? toReadonly : toReactive;
          !isReadonly2 && track2(
            rawTarget,
            "iterate",
            isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY
          );
          return shared.extend(
            // inheriting all iterator properties
            Object.create(innerIterator),
            {
              // iterator protocol
              next() {
                const { value, done } = innerIterator.next();
                return done ? { value, done } : {
                  value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
                  done
                };
              }
            }
          );
        };
      }
      function createReadonlyMethod(type) {
        return function(...args) {
          {
            const key = args[0] ? `on key "${args[0]}" ` : ``;
            warn(
              `${shared.capitalize(type)} operation ${key}failed: target is readonly.`,
              /* @__PURE__ */ toRaw(this)
            );
          }
          return type === "delete" ? false : type === "clear" ? void 0 : this;
        };
      }
      function createInstrumentations(readonly2, shallow) {
        const instrumentations = {
          get(key) {
            const target = this["__v_raw"];
            const rawTarget = /* @__PURE__ */ toRaw(target);
            const rawKey = /* @__PURE__ */ toRaw(key);
            if (!readonly2) {
              if (shared.hasChanged(key, rawKey)) {
                track2(rawTarget, "get", key);
              }
              track2(rawTarget, "get", rawKey);
            }
            const { has } = getProto(rawTarget);
            const wrap = shallow ? toShallow : readonly2 ? toReadonly : toReactive;
            if (has.call(rawTarget, key)) {
              return wrap(target.get(key));
            } else if (has.call(rawTarget, rawKey)) {
              return wrap(target.get(rawKey));
            } else if (target !== rawTarget) {
              target.get(key);
            }
          },
          get size() {
            const target = this["__v_raw"];
            !readonly2 && track2(/* @__PURE__ */ toRaw(target), "iterate", ITERATE_KEY);
            return target.size;
          },
          has(key) {
            const target = this["__v_raw"];
            const rawTarget = /* @__PURE__ */ toRaw(target);
            const rawKey = /* @__PURE__ */ toRaw(key);
            if (!readonly2) {
              if (shared.hasChanged(key, rawKey)) {
                track2(rawTarget, "has", key);
              }
              track2(rawTarget, "has", rawKey);
            }
            return key === rawKey ? target.has(key) : target.has(key) || target.has(rawKey);
          },
          forEach(callback, thisArg) {
            const observed = this;
            const target = observed["__v_raw"];
            const rawTarget = /* @__PURE__ */ toRaw(target);
            const wrap = shallow ? toShallow : readonly2 ? toReadonly : toReactive;
            !readonly2 && track2(rawTarget, "iterate", ITERATE_KEY);
            return target.forEach((value, key) => {
              return callback.call(thisArg, wrap(value), wrap(key), observed);
            });
          }
        };
        shared.extend(
          instrumentations,
          readonly2 ? {
            add: createReadonlyMethod("add"),
            set: createReadonlyMethod("set"),
            delete: createReadonlyMethod("delete"),
            clear: createReadonlyMethod("clear")
          } : {
            add(value) {
              const target = /* @__PURE__ */ toRaw(this);
              const proto = getProto(target);
              const rawValue = /* @__PURE__ */ toRaw(value);
              const valueToAdd = !shallow && !/* @__PURE__ */ isShallow(value) && !/* @__PURE__ */ isReadonly(value) ? rawValue : value;
              const hadKey = proto.has.call(target, valueToAdd) || shared.hasChanged(value, valueToAdd) && proto.has.call(target, value) || shared.hasChanged(rawValue, valueToAdd) && proto.has.call(target, rawValue);
              if (!hadKey) {
                target.add(valueToAdd);
                trigger(target, "add", valueToAdd, valueToAdd);
              }
              return this;
            },
            set(key, value) {
              if (!shallow && !/* @__PURE__ */ isShallow(value) && !/* @__PURE__ */ isReadonly(value)) {
                value = /* @__PURE__ */ toRaw(value);
              }
              const target = /* @__PURE__ */ toRaw(this);
              const { has, get } = getProto(target);
              let hadKey = has.call(target, key);
              if (!hadKey) {
                key = /* @__PURE__ */ toRaw(key);
                hadKey = has.call(target, key);
              } else {
                checkIdentityKeys(target, has, key);
              }
              const oldValue = get.call(target, key);
              target.set(key, value);
              if (!hadKey) {
                trigger(target, "add", key, value);
              } else if (shared.hasChanged(value, oldValue)) {
                trigger(target, "set", key, value, oldValue);
              }
              return this;
            },
            delete(key) {
              const target = /* @__PURE__ */ toRaw(this);
              const { has, get } = getProto(target);
              let hadKey = has.call(target, key);
              if (!hadKey) {
                key = /* @__PURE__ */ toRaw(key);
                hadKey = has.call(target, key);
              } else {
                checkIdentityKeys(target, has, key);
              }
              const oldValue = get ? get.call(target, key) : void 0;
              const result = target.delete(key);
              if (hadKey) {
                trigger(target, "delete", key, void 0, oldValue);
              }
              return result;
            },
            clear() {
              const target = /* @__PURE__ */ toRaw(this);
              const hadItems = target.size !== 0;
              const oldTarget = shared.isMap(target) ? new Map(target) : new Set(target);
              const result = target.clear();
              if (hadItems) {
                trigger(
                  target,
                  "clear",
                  void 0,
                  void 0,
                  oldTarget
                );
              }
              return result;
            }
          }
        );
        const iteratorMethods = [
          "keys",
          "values",
          "entries",
          Symbol.iterator
        ];
        iteratorMethods.forEach((method) => {
          instrumentations[method] = createIterableMethod(method, readonly2, shallow);
        });
        return instrumentations;
      }
      function createInstrumentationGetter(isReadonly2, shallow) {
        const instrumentations = createInstrumentations(isReadonly2, shallow);
        return (target, key, receiver) => {
          if (key === "__v_isReactive") {
            return !isReadonly2;
          } else if (key === "__v_isReadonly") {
            return isReadonly2;
          } else if (key === "__v_raw") {
            return target;
          }
          return Reflect.get(
            shared.hasOwn(instrumentations, key) && key in target ? instrumentations : target,
            key,
            receiver
          );
        };
      }
      var mutableCollectionHandlers = {
        get: /* @__PURE__ */ createInstrumentationGetter(false, false)
      };
      var shallowCollectionHandlers = {
        get: /* @__PURE__ */ createInstrumentationGetter(false, true)
      };
      var readonlyCollectionHandlers = {
        get: /* @__PURE__ */ createInstrumentationGetter(true, false)
      };
      var shallowReadonlyCollectionHandlers = {
        get: /* @__PURE__ */ createInstrumentationGetter(true, true)
      };
      function checkIdentityKeys(target, has, key) {
        const rawKey = /* @__PURE__ */ toRaw(key);
        if (rawKey !== key && has.call(target, rawKey)) {
          const type = shared.toRawType(target);
          warn(
            `Reactive ${type} contains both the raw and reactive versions of the same object${type === `Map` ? ` as keys` : ``}, which can lead to inconsistencies. Avoid differentiating between the raw and reactive versions of an object and only use the reactive version if possible.`
          );
        }
      }
      var reactiveMap = /* @__PURE__ */ new WeakMap();
      var shallowReactiveMap = /* @__PURE__ */ new WeakMap();
      var readonlyMap = /* @__PURE__ */ new WeakMap();
      var shallowReadonlyMap = /* @__PURE__ */ new WeakMap();
      function targetTypeMap(rawType) {
        switch (rawType) {
          case "Object":
          case "Array":
            return 1;
          case "Map":
          case "Set":
          case "WeakMap":
          case "WeakSet":
            return 2;
          default:
            return 0;
        }
      }
      // @__NO_SIDE_EFFECTS__
      function reactive(target) {
        if (/* @__PURE__ */ isReadonly(target)) {
          return target;
        }
        return createReactiveObject(
          target,
          false,
          mutableHandlers,
          mutableCollectionHandlers,
          reactiveMap
        );
      }
      // @__NO_SIDE_EFFECTS__
      function shallowReactive(target) {
        return createReactiveObject(
          target,
          false,
          shallowReactiveHandlers,
          shallowCollectionHandlers,
          shallowReactiveMap
        );
      }
      // @__NO_SIDE_EFFECTS__
      function readonly(target) {
        return createReactiveObject(
          target,
          true,
          readonlyHandlers,
          readonlyCollectionHandlers,
          readonlyMap
        );
      }
      // @__NO_SIDE_EFFECTS__
      function shallowReadonly(target) {
        return createReactiveObject(
          target,
          true,
          shallowReadonlyHandlers,
          shallowReadonlyCollectionHandlers,
          shallowReadonlyMap
        );
      }
      function createReactiveObject(target, isReadonly2, baseHandlers, collectionHandlers, proxyMap) {
        if (!shared.isObject(target)) {
          {
            warn(
              `value cannot be made ${isReadonly2 ? "readonly" : "reactive"}: ${String(
                target
              )}`
            );
          }
          return target;
        }
        if (target["__v_raw"] && !(isReadonly2 && target["__v_isReactive"])) {
          return target;
        }
        if (target["__v_skip"] || !Object.isExtensible(target)) {
          return target;
        }
        const existingProxy = proxyMap.get(target);
        if (existingProxy) {
          return existingProxy;
        }
        const targetType = targetTypeMap(shared.toRawType(target));
        if (targetType === 0) {
          return target;
        }
        const proxy = new Proxy(
          target,
          targetType === 2 ? collectionHandlers : baseHandlers
        );
        proxyMap.set(target, proxy);
        return proxy;
      }
      // @__NO_SIDE_EFFECTS__
      function isReactive(value) {
        if (/* @__PURE__ */ isReadonly(value)) {
          return /* @__PURE__ */ isReactive(value["__v_raw"]);
        }
        return !!(value && value["__v_isReactive"]);
      }
      // @__NO_SIDE_EFFECTS__
      function isReadonly(value) {
        return !!(value && value["__v_isReadonly"]);
      }
      // @__NO_SIDE_EFFECTS__
      function isShallow(value) {
        return !!(value && value["__v_isShallow"]);
      }
      // @__NO_SIDE_EFFECTS__
      function isProxy(value) {
        return value ? !!value["__v_raw"] : false;
      }
      // @__NO_SIDE_EFFECTS__
      function toRaw(observed) {
        const raw = observed && observed["__v_raw"];
        return raw ? /* @__PURE__ */ toRaw(raw) : observed;
      }
      function markRaw(value) {
        if (!shared.hasOwn(value, "__v_skip") && Object.isExtensible(value)) {
          shared.def(value, "__v_skip", true);
        }
        return value;
      }
      var toReactive = (value) => shared.isObject(value) ? /* @__PURE__ */ reactive(value) : value;
      var toReadonly = (value) => shared.isObject(value) ? /* @__PURE__ */ readonly(value) : value;
      // @__NO_SIDE_EFFECTS__
      function isRef(r) {
        return r ? r["__v_isRef"] === true : false;
      }
      // @__NO_SIDE_EFFECTS__
      function ref(value) {
        return createRef(value, false);
      }
      // @__NO_SIDE_EFFECTS__
      function shallowRef(value) {
        return createRef(value, true);
      }
      function createRef(rawValue, shallow) {
        if (/* @__PURE__ */ isRef(rawValue)) {
          return rawValue;
        }
        return new RefImpl(rawValue, shallow);
      }
      var RefImpl = class {
        constructor(value, isShallow2) {
          this.dep = new Dep();
          this["__v_isRef"] = true;
          this["__v_isShallow"] = false;
          this._rawValue = isShallow2 ? value : /* @__PURE__ */ toRaw(value);
          this._value = isShallow2 ? value : toReactive(value);
          this["__v_isShallow"] = isShallow2;
        }
        get value() {
          {
            this.dep.track({
              target: this,
              type: "get",
              key: "value"
            });
          }
          return this._value;
        }
        set value(newValue) {
          const oldValue = this._rawValue;
          const useDirectValue = this["__v_isShallow"] || /* @__PURE__ */ isShallow(newValue) || /* @__PURE__ */ isReadonly(newValue);
          newValue = useDirectValue ? newValue : /* @__PURE__ */ toRaw(newValue);
          if (shared.hasChanged(newValue, oldValue)) {
            this._rawValue = newValue;
            this._value = useDirectValue ? newValue : toReactive(newValue);
            {
              this.dep.trigger({
                target: this,
                type: "set",
                key: "value",
                newValue,
                oldValue
              });
            }
          }
        }
      };
      function triggerRef(ref2) {
        if (ref2.dep) {
          {
            ref2.dep.trigger({
              target: ref2,
              type: "set",
              key: "value",
              newValue: ref2._value
            });
          }
        }
      }
      function unref(ref2) {
        return /* @__PURE__ */ isRef(ref2) ? ref2.value : ref2;
      }
      function toValue(source) {
        return shared.isFunction(source) ? source() : unref(source);
      }
      var shallowUnwrapHandlers = {
        get: (target, key, receiver) => key === "__v_raw" ? target : unref(Reflect.get(target, key, receiver)),
        set: (target, key, value, receiver) => {
          const oldValue = target[key];
          if (/* @__PURE__ */ isRef(oldValue) && !/* @__PURE__ */ isRef(value)) {
            oldValue.value = value;
            return true;
          } else {
            return Reflect.set(target, key, value, receiver);
          }
        }
      };
      function proxyRefs(objectWithRefs) {
        return /* @__PURE__ */ isReactive(objectWithRefs) ? objectWithRefs : new Proxy(objectWithRefs, shallowUnwrapHandlers);
      }
      var CustomRefImpl = class {
        constructor(factory) {
          this["__v_isRef"] = true;
          this._value = void 0;
          const dep = this.dep = new Dep();
          const { get, set } = factory(dep.track.bind(dep), dep.trigger.bind(dep));
          this._get = get;
          this._set = set;
        }
        get value() {
          return this._value = this._get();
        }
        set value(newVal) {
          this._set(newVal);
        }
      };
      function customRef(factory) {
        return new CustomRefImpl(factory);
      }
      // @__NO_SIDE_EFFECTS__
      function toRefs(object) {
        if (!/* @__PURE__ */ isProxy(object)) {
          warn(`toRefs() expects a reactive object but received a plain one.`);
        }
        const ret = shared.isArray(object) ? new Array(object.length) : {};
        for (const key in object) {
          ret[key] = propertyToRef(object, key);
        }
        return ret;
      }
      var ObjectRefImpl = class {
        constructor(_object, key, _defaultValue) {
          this._object = _object;
          this._defaultValue = _defaultValue;
          this["__v_isRef"] = true;
          this._value = void 0;
          this._key = shared.isSymbol(key) ? key : String(key);
          this._raw = /* @__PURE__ */ toRaw(_object);
          let shallow = true;
          let obj = _object;
          if (!shared.isArray(_object) || shared.isSymbol(this._key) || !shared.isIntegerKey(this._key)) {
            do {
              shallow = !/* @__PURE__ */ isProxy(obj) || /* @__PURE__ */ isShallow(obj);
            } while (shallow && (obj = obj["__v_raw"]));
          }
          this._shallow = shallow;
        }
        get value() {
          let val = this._object[this._key];
          if (this._shallow) {
            val = unref(val);
          }
          return this._value = val === void 0 ? this._defaultValue : val;
        }
        set value(newVal) {
          if (this._shallow && /* @__PURE__ */ isRef(this._raw[this._key])) {
            const nestedRef = this._object[this._key];
            if (/* @__PURE__ */ isRef(nestedRef)) {
              nestedRef.value = newVal;
              return;
            }
          }
          this._object[this._key] = newVal;
        }
        get dep() {
          return getDepFromReactive(this._raw, this._key);
        }
      };
      var GetterRefImpl = class {
        constructor(_getter) {
          this._getter = _getter;
          this["__v_isRef"] = true;
          this["__v_isReadonly"] = true;
          this._value = void 0;
        }
        get value() {
          return this._value = this._getter();
        }
      };
      // @__NO_SIDE_EFFECTS__
      function toRef(source, key, defaultValue) {
        if (/* @__PURE__ */ isRef(source)) {
          return source;
        } else if (shared.isFunction(source)) {
          return new GetterRefImpl(source);
        } else if (shared.isObject(source) && arguments.length > 1) {
          return propertyToRef(source, key, defaultValue);
        } else {
          return /* @__PURE__ */ ref(source);
        }
      }
      function propertyToRef(source, key, defaultValue) {
        return new ObjectRefImpl(source, key, defaultValue);
      }
      var ComputedRefImpl = class {
        constructor(fn, setter, isSSR) {
          this.fn = fn;
          this.setter = setter;
          this._value = void 0;
          this.dep = new Dep(this);
          this.__v_isRef = true;
          this.deps = void 0;
          this.depsTail = void 0;
          this.flags = 16;
          this.globalVersion = globalVersion - 1;
          this.next = void 0;
          this.effect = this;
          this["__v_isReadonly"] = !setter;
          this.isSSR = isSSR;
        }
        /**
         * @internal
         */
        notify() {
          this.flags |= 16;
          if (!(this.flags & 8) && // avoid infinite self recursion
          activeSub !== this) {
            batch(this, true);
            return true;
          }
        }
        get value() {
          const link = this.dep.track({
            target: this,
            type: "get",
            key: "value"
          });
          refreshComputed(this);
          if (link) {
            link.version = this.dep.version;
          }
          return this._value;
        }
        set value(newValue) {
          if (this.setter) {
            this.setter(newValue);
          } else {
            warn("Write operation failed: computed value is readonly");
          }
        }
      };
      // @__NO_SIDE_EFFECTS__
      function computed(getterOrOptions, debugOptions, isSSR = false) {
        let getter;
        let setter;
        if (shared.isFunction(getterOrOptions)) {
          getter = getterOrOptions;
        } else {
          getter = getterOrOptions.get;
          setter = getterOrOptions.set;
        }
        const cRef = new ComputedRefImpl(getter, setter, isSSR);
        if (debugOptions && !isSSR) {
          cRef.onTrack = debugOptions.onTrack;
          cRef.onTrigger = debugOptions.onTrigger;
        }
        return cRef;
      }
      var TrackOpTypes = {
        "GET": "get",
        "HAS": "has",
        "ITERATE": "iterate"
      };
      var TriggerOpTypes = {
        "SET": "set",
        "ADD": "add",
        "DELETE": "delete",
        "CLEAR": "clear"
      };
      var ReactiveFlags = {
        "SKIP": "__v_skip",
        "IS_REACTIVE": "__v_isReactive",
        "IS_READONLY": "__v_isReadonly",
        "IS_SHALLOW": "__v_isShallow",
        "RAW": "__v_raw",
        "IS_REF": "__v_isRef"
      };
      var WatchErrorCodes = {
        "WATCH_GETTER": 2,
        "2": "WATCH_GETTER",
        "WATCH_CALLBACK": 3,
        "3": "WATCH_CALLBACK",
        "WATCH_CLEANUP": 4,
        "4": "WATCH_CLEANUP"
      };
      var INITIAL_WATCHER_VALUE = {};
      var cleanupMap = /* @__PURE__ */ new WeakMap();
      var activeWatcher = void 0;
      function getCurrentWatcher() {
        return activeWatcher;
      }
      function onWatcherCleanup(cleanupFn, failSilently = false, owner = activeWatcher) {
        if (owner) {
          let cleanups = cleanupMap.get(owner);
          if (!cleanups) cleanupMap.set(owner, cleanups = []);
          cleanups.push(cleanupFn);
        } else if (!failSilently) {
          warn(
            `onWatcherCleanup() was called when there was no active watcher to associate with.`
          );
        }
      }
      function watch(source, cb, options = shared.EMPTY_OBJ) {
        const { immediate, deep, once, scheduler, augmentJob, call } = options;
        const warnInvalidSource = (s) => {
          (options.onWarn || warn)(
            `Invalid watch source: `,
            s,
            `A watch source can only be a getter/effect function, a ref, a reactive object, or an array of these types.`
          );
        };
        const reactiveGetter = (source2) => {
          if (deep) return source2;
          if (/* @__PURE__ */ isShallow(source2) || deep === false || deep === 0)
            return traverse(source2, 1);
          return traverse(source2);
        };
        let effect2;
        let getter;
        let cleanup;
        let boundCleanup;
        let forceTrigger = false;
        let isMultiSource = false;
        if (/* @__PURE__ */ isRef(source)) {
          getter = () => source.value;
          forceTrigger = /* @__PURE__ */ isShallow(source);
        } else if (/* @__PURE__ */ isReactive(source)) {
          getter = () => reactiveGetter(source);
          forceTrigger = true;
        } else if (shared.isArray(source)) {
          isMultiSource = true;
          forceTrigger = source.some((s) => /* @__PURE__ */ isReactive(s) || /* @__PURE__ */ isShallow(s));
          getter = () => source.map((s) => {
            if (/* @__PURE__ */ isRef(s)) {
              return s.value;
            } else if (/* @__PURE__ */ isReactive(s)) {
              return reactiveGetter(s);
            } else if (shared.isFunction(s)) {
              return call ? call(s, 2) : s();
            } else {
              warnInvalidSource(s);
            }
          });
        } else if (shared.isFunction(source)) {
          if (cb) {
            getter = call ? () => call(source, 2) : source;
          } else {
            getter = () => {
              if (cleanup) {
                pauseTracking();
                try {
                  cleanup();
                } finally {
                  resetTracking();
                }
              }
              const currentEffect = activeWatcher;
              activeWatcher = effect2;
              try {
                return call ? call(source, 3, [boundCleanup]) : source(boundCleanup);
              } finally {
                activeWatcher = currentEffect;
              }
            };
          }
        } else {
          getter = shared.NOOP;
          warnInvalidSource(source);
        }
        if (cb && deep) {
          const baseGetter = getter;
          const depth = deep === true ? Infinity : deep;
          getter = () => traverse(baseGetter(), depth);
        }
        const scope = getCurrentScope();
        const watchHandle = () => {
          effect2.stop();
          if (scope && scope.active) {
            shared.remove(scope.effects, effect2);
          }
        };
        if (once && cb) {
          const _cb = cb;
          cb = (...args) => {
            const res = _cb(...args);
            watchHandle();
            return res;
          };
        }
        let oldValue = isMultiSource ? new Array(source.length).fill(INITIAL_WATCHER_VALUE) : INITIAL_WATCHER_VALUE;
        const job = (immediateFirstRun) => {
          if (!(effect2.flags & 1) || !effect2.dirty && !immediateFirstRun) {
            return;
          }
          if (cb) {
            const newValue = effect2.run();
            if (immediateFirstRun || deep || forceTrigger || (isMultiSource ? newValue.some((v, i) => shared.hasChanged(v, oldValue[i])) : shared.hasChanged(newValue, oldValue))) {
              if (cleanup) {
                cleanup();
              }
              const currentWatcher = activeWatcher;
              activeWatcher = effect2;
              try {
                const args = [
                  newValue,
                  // pass undefined as the old value when it's changed for the first time
                  oldValue === INITIAL_WATCHER_VALUE ? void 0 : isMultiSource && oldValue[0] === INITIAL_WATCHER_VALUE ? [] : oldValue,
                  boundCleanup
                ];
                oldValue = newValue;
                call ? call(cb, 3, args) : (
                  // @ts-expect-error
                  cb(...args)
                );
              } finally {
                activeWatcher = currentWatcher;
              }
            }
          } else {
            effect2.run();
          }
        };
        if (augmentJob) {
          augmentJob(job);
        }
        effect2 = new ReactiveEffect(getter);
        effect2.scheduler = scheduler ? () => scheduler(job, false) : job;
        boundCleanup = (fn) => onWatcherCleanup(fn, false, effect2);
        cleanup = effect2.onStop = () => {
          const cleanups = cleanupMap.get(effect2);
          if (cleanups) {
            if (call) {
              call(cleanups, 4);
            } else {
              for (const cleanup2 of cleanups) cleanup2();
            }
            cleanupMap.delete(effect2);
          }
        };
        {
          effect2.onTrack = options.onTrack;
          effect2.onTrigger = options.onTrigger;
        }
        if (cb) {
          if (immediate) {
            job(true);
          } else {
            oldValue = effect2.run();
          }
        } else if (scheduler) {
          scheduler(job.bind(null, true), true);
        } else {
          effect2.run();
        }
        watchHandle.pause = effect2.pause.bind(effect2);
        watchHandle.resume = effect2.resume.bind(effect2);
        watchHandle.stop = watchHandle;
        return watchHandle;
      }
      function traverse(value, depth = Infinity, seen) {
        if (depth <= 0 || !shared.isObject(value) || value["__v_skip"]) {
          return value;
        }
        seen = seen || /* @__PURE__ */ new Map();
        if ((seen.get(value) || 0) >= depth) {
          return value;
        }
        seen.set(value, depth);
        depth--;
        if (/* @__PURE__ */ isRef(value)) {
          traverse(value.value, depth, seen);
        } else if (shared.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            traverse(value[i], depth, seen);
          }
        } else if (shared.isSet(value) || shared.isMap(value)) {
          value.forEach((v) => {
            traverse(v, depth, seen);
          });
        } else if (shared.isPlainObject(value)) {
          for (const key in value) {
            traverse(value[key], depth, seen);
          }
          for (const key of Object.getOwnPropertySymbols(value)) {
            if (Object.prototype.propertyIsEnumerable.call(value, key)) {
              traverse(value[key], depth, seen);
            }
          }
        }
        return value;
      }
      exports.ARRAY_ITERATE_KEY = ARRAY_ITERATE_KEY;
      exports.EffectFlags = EffectFlags;
      exports.EffectScope = EffectScope;
      exports.ITERATE_KEY = ITERATE_KEY;
      exports.MAP_KEY_ITERATE_KEY = MAP_KEY_ITERATE_KEY;
      exports.ReactiveEffect = ReactiveEffect;
      exports.ReactiveFlags = ReactiveFlags;
      exports.TrackOpTypes = TrackOpTypes;
      exports.TriggerOpTypes = TriggerOpTypes;
      exports.WatchErrorCodes = WatchErrorCodes;
      exports.computed = computed;
      exports.customRef = customRef;
      exports.effect = effect;
      exports.effectScope = effectScope;
      exports.enableTracking = enableTracking;
      exports.getCurrentScope = getCurrentScope;
      exports.getCurrentWatcher = getCurrentWatcher;
      exports.isProxy = isProxy;
      exports.isReactive = isReactive;
      exports.isReadonly = isReadonly;
      exports.isRef = isRef;
      exports.isShallow = isShallow;
      exports.markRaw = markRaw;
      exports.onEffectCleanup = onEffectCleanup;
      exports.onScopeDispose = onScopeDispose;
      exports.onWatcherCleanup = onWatcherCleanup;
      exports.pauseTracking = pauseTracking;
      exports.proxyRefs = proxyRefs;
      exports.reactive = reactive;
      exports.reactiveReadArray = reactiveReadArray;
      exports.readonly = readonly;
      exports.ref = ref;
      exports.resetTracking = resetTracking;
      exports.shallowReactive = shallowReactive;
      exports.shallowReadArray = shallowReadArray;
      exports.shallowReadonly = shallowReadonly;
      exports.shallowRef = shallowRef;
      exports.stop = stop;
      exports.toRaw = toRaw;
      exports.toReactive = toReactive;
      exports.toReadonly = toReadonly;
      exports.toRef = toRef;
      exports.toRefs = toRefs;
      exports.toValue = toValue;
      exports.track = track2;
      exports.traverse = traverse;
      exports.trigger = trigger;
      exports.triggerRef = triggerRef;
      exports.unref = unref;
      exports.watch = watch;
    }
  });

  // node_modules/.pnpm/@vue+reactivity@3.5.42/node_modules/@vue/reactivity/index.js
  var require_reactivity = __commonJS({
    "node_modules/.pnpm/@vue+reactivity@3.5.42/node_modules/@vue/reactivity/index.js"(exports, module) {
      "use strict";
      if (false) {
        module.exports = null;
      } else {
        module.exports = require_reactivity_cjs();
      }
    }
  });

  // node_modules/.pnpm/@vue+runtime-core@3.5.42/node_modules/@vue/runtime-core/dist/runtime-core.cjs.js
  var require_runtime_core_cjs = __commonJS({
    "node_modules/.pnpm/@vue+runtime-core@3.5.42/node_modules/@vue/runtime-core/dist/runtime-core.cjs.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      var reactivity = require_reactivity();
      var shared = require_shared();
      var stack = [];
      function pushWarningContext(vnode) {
        stack.push(vnode);
      }
      function popWarningContext() {
        stack.pop();
      }
      var isWarning = false;
      function warn$1(msg, ...args) {
        if (isWarning) return;
        isWarning = true;
        reactivity.pauseTracking();
        const instance = stack.length ? stack[stack.length - 1].component : null;
        const appWarnHandler = instance && instance.appContext.config.warnHandler;
        const trace = getComponentTrace();
        if (appWarnHandler) {
          callWithErrorHandling(
            appWarnHandler,
            instance,
            11,
            [
              // eslint-disable-next-line no-restricted-syntax
              msg + args.map((a) => {
                var _a4, _b3;
                return (_b3 = (_a4 = a.toString) == null ? void 0 : _a4.call(a)) != null ? _b3 : JSON.stringify(a);
              }).join(""),
              instance && instance.proxy,
              trace.map(
                ({ vnode }) => `at <${formatComponentName(instance, vnode.type)}>`
              ).join("\n"),
              trace
            ]
          );
        } else {
          const warnArgs = [`[Vue warn]: ${msg}`, ...args];
          if (trace.length && // avoid spamming console during tests
          true) {
            warnArgs.push(`
`, ...formatTrace(trace));
          }
          console.warn(...warnArgs);
        }
        reactivity.resetTracking();
        isWarning = false;
      }
      function getComponentTrace() {
        let currentVNode = stack[stack.length - 1];
        if (!currentVNode) {
          return [];
        }
        const normalizedStack = [];
        while (currentVNode) {
          const last = normalizedStack[0];
          if (last && last.vnode === currentVNode) {
            last.recurseCount++;
          } else {
            normalizedStack.push({
              vnode: currentVNode,
              recurseCount: 0
            });
          }
          const parentInstance = currentVNode.component && currentVNode.component.parent;
          currentVNode = parentInstance && parentInstance.vnode;
        }
        return normalizedStack;
      }
      function formatTrace(trace) {
        const logs = [];
        trace.forEach((entry, i) => {
          logs.push(...i === 0 ? [] : [`
`], ...formatTraceEntry(entry));
        });
        return logs;
      }
      function formatTraceEntry({ vnode, recurseCount }) {
        const postfix = recurseCount > 0 ? `... (${recurseCount} recursive calls)` : ``;
        const isRoot = vnode.component ? vnode.component.parent == null : false;
        const open = ` at <${formatComponentName(
          vnode.component,
          vnode.type,
          isRoot
        )}`;
        const close = `>` + postfix;
        return vnode.props ? [open, ...formatProps(vnode.props), close] : [open + close];
      }
      function formatProps(props) {
        const res = [];
        const keys = Object.keys(props);
        keys.slice(0, 3).forEach((key) => {
          res.push(...formatProp(key, props[key]));
        });
        if (keys.length > 3) {
          res.push(` ...`);
        }
        return res;
      }
      function formatProp(key, value, raw) {
        if (shared.isString(value)) {
          value = JSON.stringify(value);
          return raw ? value : [`${key}=${value}`];
        } else if (typeof value === "number" || typeof value === "boolean" || value == null) {
          return raw ? value : [`${key}=${value}`];
        } else if (reactivity.isRef(value)) {
          value = formatProp(key, reactivity.toRaw(value.value), true);
          return raw ? value : [`${key}=Ref<`, value, `>`];
        } else if (shared.isFunction(value)) {
          return [`${key}=fn${value.name ? `<${value.name}>` : ``}`];
        } else {
          value = reactivity.toRaw(value);
          return raw ? value : [`${key}=`, value];
        }
      }
      function assertNumber(val, type) {
        if (val === void 0) {
          return;
        } else if (typeof val !== "number") {
          warn$1(`${type} is not a valid number - got ${JSON.stringify(val)}.`);
        } else if (isNaN(val)) {
          warn$1(`${type} is NaN - the duration expression might be incorrect.`);
        }
      }
      var ErrorCodes = {
        "SETUP_FUNCTION": 0,
        "0": "SETUP_FUNCTION",
        "RENDER_FUNCTION": 1,
        "1": "RENDER_FUNCTION",
        "NATIVE_EVENT_HANDLER": 5,
        "5": "NATIVE_EVENT_HANDLER",
        "COMPONENT_EVENT_HANDLER": 6,
        "6": "COMPONENT_EVENT_HANDLER",
        "VNODE_HOOK": 7,
        "7": "VNODE_HOOK",
        "DIRECTIVE_HOOK": 8,
        "8": "DIRECTIVE_HOOK",
        "TRANSITION_HOOK": 9,
        "9": "TRANSITION_HOOK",
        "APP_ERROR_HANDLER": 10,
        "10": "APP_ERROR_HANDLER",
        "APP_WARN_HANDLER": 11,
        "11": "APP_WARN_HANDLER",
        "FUNCTION_REF": 12,
        "12": "FUNCTION_REF",
        "ASYNC_COMPONENT_LOADER": 13,
        "13": "ASYNC_COMPONENT_LOADER",
        "SCHEDULER": 14,
        "14": "SCHEDULER",
        "COMPONENT_UPDATE": 15,
        "15": "COMPONENT_UPDATE",
        "APP_UNMOUNT_CLEANUP": 16,
        "16": "APP_UNMOUNT_CLEANUP"
      };
      var ErrorTypeStrings$1 = {
        ["sp"]: "serverPrefetch hook",
        ["bc"]: "beforeCreate hook",
        ["c"]: "created hook",
        ["bm"]: "beforeMount hook",
        ["m"]: "mounted hook",
        ["bu"]: "beforeUpdate hook",
        ["u"]: "updated",
        ["bum"]: "beforeUnmount hook",
        ["um"]: "unmounted hook",
        ["a"]: "activated hook",
        ["da"]: "deactivated hook",
        ["ec"]: "errorCaptured hook",
        ["rtc"]: "renderTracked hook",
        ["rtg"]: "renderTriggered hook",
        [0]: "setup function",
        [1]: "render function",
        [2]: "watcher getter",
        [3]: "watcher callback",
        [4]: "watcher cleanup function",
        [5]: "native event handler",
        [6]: "component event handler",
        [7]: "vnode hook",
        [8]: "directive hook",
        [9]: "transition hook",
        [10]: "app errorHandler",
        [11]: "app warnHandler",
        [12]: "ref function",
        [13]: "async component loader",
        [14]: "scheduler flush",
        [15]: "component update",
        [16]: "app unmount cleanup function"
      };
      function callWithErrorHandling(fn, instance, type, args) {
        try {
          return args ? fn(...args) : fn();
        } catch (err) {
          handleError(err, instance, type);
        }
      }
      function callWithAsyncErrorHandling(fn, instance, type, args) {
        if (shared.isFunction(fn)) {
          const res = callWithErrorHandling(fn, instance, type, args);
          if (res && shared.isPromise(res)) {
            res.catch((err) => {
              handleError(err, instance, type);
            });
          }
          return res;
        }
        if (shared.isArray(fn)) {
          const values = [];
          for (let i = 0; i < fn.length; i++) {
            values.push(callWithAsyncErrorHandling(fn[i], instance, type, args));
          }
          return values;
        } else {
          warn$1(
            `Invalid value type passed to callWithAsyncErrorHandling(): ${typeof fn}`
          );
        }
      }
      function handleError(err, instance, type, throwInDev = true) {
        const contextVNode = instance ? instance.vnode : null;
        const { errorHandler, throwUnhandledErrorInProduction } = instance && instance.appContext.config || shared.EMPTY_OBJ;
        if (instance) {
          let cur = instance.parent;
          const exposedInstance = instance.proxy;
          const errorInfo = ErrorTypeStrings$1[type];
          while (cur) {
            const errorCapturedHooks = cur.ec;
            if (errorCapturedHooks) {
              for (let i = 0; i < errorCapturedHooks.length; i++) {
                if (errorCapturedHooks[i](err, exposedInstance, errorInfo) === false) {
                  return;
                }
              }
            }
            cur = cur.parent;
          }
          if (errorHandler) {
            reactivity.pauseTracking();
            callWithErrorHandling(errorHandler, null, 10, [
              err,
              exposedInstance,
              errorInfo
            ]);
            reactivity.resetTracking();
            return;
          }
        }
        logError(err, type, contextVNode, throwInDev, throwUnhandledErrorInProduction);
      }
      function logError(err, type, contextVNode, throwInDev = true, throwInProd = false) {
        {
          const info = ErrorTypeStrings$1[type];
          if (contextVNode) {
            pushWarningContext(contextVNode);
          }
          warn$1(`Unhandled error${info ? ` during execution of ${info}` : ``}`);
          if (contextVNode) {
            popWarningContext();
          }
          if (throwInDev) {
            throw err;
          } else {
            console.error(err);
          }
        }
      }
      var queue = [];
      var flushIndex = -1;
      var pendingPostFlushCbs = [];
      var activePostFlushCbs = null;
      var postFlushIndex = 0;
      var resolvedPromise = /* @__PURE__ */ Promise.resolve();
      var currentFlushPromise = null;
      var RECURSION_LIMIT = 100;
      function nextTick(fn) {
        const p = currentFlushPromise || resolvedPromise;
        return fn ? p.then(this ? fn.bind(this) : fn) : p;
      }
      function findInsertionIndex(id) {
        let start = flushIndex + 1;
        let end = queue.length;
        while (start < end) {
          const middle = start + end >>> 1;
          const middleJob = queue[middle];
          const middleJobId = getId(middleJob);
          if (middleJobId < id || middleJobId === id && middleJob.flags & 2) {
            start = middle + 1;
          } else {
            end = middle;
          }
        }
        return start;
      }
      function queueJob(job) {
        if (!(job.flags & 1)) {
          const jobId = getId(job);
          const lastJob = queue[queue.length - 1];
          if (!lastJob || // fast path when the job id is larger than the tail
          !(job.flags & 2) && jobId >= getId(lastJob)) {
            queue.push(job);
          } else {
            queue.splice(findInsertionIndex(jobId), 0, job);
          }
          job.flags |= 1;
          queueFlush();
        }
      }
      function queueFlush() {
        if (!currentFlushPromise) {
          currentFlushPromise = resolvedPromise.then(flushJobs);
        }
      }
      function queuePostFlushCb(cb) {
        if (!shared.isArray(cb)) {
          if (activePostFlushCbs && cb.id === -1) {
            activePostFlushCbs.splice(postFlushIndex + 1, 0, cb);
          } else if (!(cb.flags & 1)) {
            pendingPostFlushCbs.push(cb);
            cb.flags |= 1;
          }
        } else {
          for (let i = 0; i < cb.length; i++) {
            pendingPostFlushCbs.push(cb[i]);
          }
        }
        queueFlush();
      }
      function flushPreFlushCbs(instance, seen, i = flushIndex + 1) {
        {
          seen = seen || /* @__PURE__ */ new Map();
        }
        for (; i < queue.length; i++) {
          const cb = queue[i];
          if (cb && cb.flags & 2) {
            if (instance && cb.id !== instance.uid) {
              continue;
            }
            if (checkRecursiveUpdates(seen, cb)) {
              continue;
            }
            queue.splice(i, 1);
            i--;
            if (cb.flags & 4) {
              cb.flags &= -2;
            }
            cb();
            if (!(cb.flags & 4)) {
              cb.flags &= -2;
            }
          }
        }
      }
      function flushPostFlushCbs(seen) {
        if (pendingPostFlushCbs.length) {
          const deduped = [...new Set(pendingPostFlushCbs)].sort(
            (a, b) => getId(a) - getId(b)
          );
          pendingPostFlushCbs.length = 0;
          if (activePostFlushCbs) {
            for (let i = 0; i < deduped.length; i++) {
              activePostFlushCbs.push(deduped[i]);
            }
            return;
          }
          activePostFlushCbs = deduped;
          {
            seen = seen || /* @__PURE__ */ new Map();
          }
          for (postFlushIndex = 0; postFlushIndex < activePostFlushCbs.length; postFlushIndex++) {
            const cb = activePostFlushCbs[postFlushIndex];
            if (checkRecursiveUpdates(seen, cb)) {
              continue;
            }
            if (cb.flags & 4) {
              cb.flags &= -2;
            }
            if (!(cb.flags & 8)) cb();
            cb.flags &= -2;
          }
          activePostFlushCbs = null;
          postFlushIndex = 0;
        }
      }
      var getId = (job) => job.id == null ? job.flags & 2 ? -1 : Infinity : job.id;
      function flushJobs(seen) {
        {
          seen = seen || /* @__PURE__ */ new Map();
        }
        const check = (job) => checkRecursiveUpdates(seen, job);
        try {
          for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
            const job = queue[flushIndex];
            if (job && !(job.flags & 8)) {
              if (check(job)) {
                continue;
              }
              if (job.flags & 4) {
                job.flags &= ~1;
              }
              callWithErrorHandling(
                job,
                job.i,
                job.i ? 15 : 14
              );
              if (!(job.flags & 4)) {
                job.flags &= ~1;
              }
            }
          }
        } finally {
          for (; flushIndex < queue.length; flushIndex++) {
            const job = queue[flushIndex];
            if (job) {
              job.flags &= -2;
            }
          }
          flushIndex = -1;
          queue.length = 0;
          flushPostFlushCbs(seen);
          currentFlushPromise = null;
          if (queue.length || pendingPostFlushCbs.length) {
            flushJobs(seen);
          }
        }
      }
      function checkRecursiveUpdates(seen, fn) {
        const count = seen.get(fn) || 0;
        if (count > RECURSION_LIMIT) {
          const instance = fn.i;
          const componentName = instance && getComponentName(instance.type);
          handleError(
            `Maximum recursive updates exceeded${componentName ? ` in component <${componentName}>` : ``}. This means you have a reactive effect that is mutating its own dependencies and thus recursively triggering itself. Possible sources include component template, render function, updated hook or watcher source function.`,
            null,
            10
          );
          return true;
        }
        seen.set(fn, count + 1);
        return false;
      }
      var isHmrUpdating = false;
      var setHmrUpdating = (v) => {
        try {
          return isHmrUpdating;
        } finally {
          isHmrUpdating = v;
        }
      };
      var hmrDirtyComponents = /* @__PURE__ */ new Map();
      {
        shared.getGlobalThis().__VUE_HMR_RUNTIME__ = {
          createRecord: tryWrap(createRecord),
          rerender: tryWrap(rerender),
          reload: tryWrap(reload)
        };
      }
      var map = /* @__PURE__ */ new Map();
      function registerHMR(instance) {
        const id = instance.type.__hmrId;
        let record = map.get(id);
        if (!record) {
          createRecord(id, instance.type);
          record = map.get(id);
        }
        record.instances.add(instance);
      }
      function unregisterHMR(instance) {
        map.get(instance.type.__hmrId).instances.delete(instance);
      }
      function createRecord(id, initialDef) {
        if (map.has(id)) {
          return false;
        }
        map.set(id, {
          initialDef: normalizeClassComponent(initialDef),
          instances: /* @__PURE__ */ new Set()
        });
        return true;
      }
      function normalizeClassComponent(component) {
        return isClassComponent(component) ? component.__vccOpts : component;
      }
      function rerender(id, newRender) {
        const record = map.get(id);
        if (!record) {
          return;
        }
        record.initialDef.render = newRender;
        [...record.instances].forEach((instance) => {
          if (newRender) {
            instance.render = newRender;
            normalizeClassComponent(instance.type).render = newRender;
          }
          instance.renderCache = [];
          isHmrUpdating = true;
          if (!(instance.job.flags & 8)) {
            instance.update();
          }
          isHmrUpdating = false;
        });
      }
      function reload(id, newComp) {
        const record = map.get(id);
        if (!record) return;
        newComp = normalizeClassComponent(newComp);
        updateComponentDef(record.initialDef, newComp);
        const instances = [...record.instances];
        for (let i = 0; i < instances.length; i++) {
          const instance = instances[i];
          const oldComp = normalizeClassComponent(instance.type);
          let dirtyInstances = hmrDirtyComponents.get(oldComp);
          if (!dirtyInstances) {
            if (oldComp !== record.initialDef) {
              updateComponentDef(oldComp, newComp);
            }
            hmrDirtyComponents.set(oldComp, dirtyInstances = /* @__PURE__ */ new Set());
          }
          dirtyInstances.add(instance);
          instance.appContext.propsCache.delete(instance.type);
          instance.appContext.emitsCache.delete(instance.type);
          instance.appContext.optionsCache.delete(instance.type);
          if (instance.ceReload) {
            dirtyInstances.add(instance);
            instance.ceReload(newComp.styles);
            dirtyInstances.delete(instance);
          } else if (instance.parent) {
            queueJob(() => {
              if (!(instance.job.flags & 8)) {
                isHmrUpdating = true;
                instance.parent.update();
                isHmrUpdating = false;
                dirtyInstances.delete(instance);
              }
            });
          } else if (instance.appContext.reload) {
            instance.appContext.reload();
          } else if (typeof window !== "undefined") {
            window.location.reload();
          } else {
            console.warn(
              "[HMR] Root or manually mounted instance modified. Full reload required."
            );
          }
          if (instance.root.ce && instance !== instance.root) {
            instance.root.ce._removeChildStyle(oldComp);
          }
        }
        queuePostFlushCb(() => {
          hmrDirtyComponents.clear();
        });
      }
      function updateComponentDef(oldComp, newComp) {
        shared.extend(oldComp, newComp);
        for (const key in oldComp) {
          if (key !== "__file" && !(key in newComp)) {
            delete oldComp[key];
          }
        }
      }
      function tryWrap(fn) {
        return (id, arg) => {
          try {
            return fn(id, arg);
          } catch (e) {
            console.error(e);
            console.warn(
              `[HMR] Something went wrong during Vue component hot-reload. Full reload required.`
            );
          }
        };
      }
      var devtools$1;
      var buffer = [];
      var devtoolsNotInstalled = false;
      function emit$1(event, ...args) {
        if (devtools$1) {
          devtools$1.emit(event, ...args);
        } else if (!devtoolsNotInstalled) {
          buffer.push({ event, args });
        }
      }
      function setDevtoolsHook$1(hook, target) {
        var _a4, _b3;
        devtools$1 = hook;
        if (devtools$1) {
          devtools$1.enabled = true;
          buffer.forEach(({ event, args }) => devtools$1.emit(event, ...args));
          buffer = [];
        } else if (
          // handle late devtools injection - only do this if we are in an actual
          // browser environment to avoid the timer handle stalling test runner exit
          // (#4815)
          typeof window !== "undefined" && // some envs mock window but not fully
          window.HTMLElement && // also exclude jsdom
          // eslint-disable-next-line no-restricted-syntax
          !((_b3 = (_a4 = window.navigator) == null ? void 0 : _a4.userAgent) == null ? void 0 : _b3.includes("jsdom"))
        ) {
          const replay = target.__VUE_DEVTOOLS_HOOK_REPLAY__ = target.__VUE_DEVTOOLS_HOOK_REPLAY__ || [];
          replay.push((newHook) => {
            setDevtoolsHook$1(newHook, target);
          });
          setTimeout(() => {
            if (!devtools$1) {
              target.__VUE_DEVTOOLS_HOOK_REPLAY__ = null;
              devtoolsNotInstalled = true;
              buffer = [];
            }
          }, 3e3);
        } else {
          devtoolsNotInstalled = true;
          buffer = [];
        }
      }
      function devtoolsInitApp(app, version2) {
        emit$1("app:init", app, version2, {
          Fragment,
          Text,
          Comment,
          Static
        });
      }
      function devtoolsUnmountApp(app) {
        emit$1("app:unmount", app);
      }
      var devtoolsComponentAdded = /* @__PURE__ */ createDevtoolsComponentHook(
        "component:added"
        /* COMPONENT_ADDED */
      );
      var devtoolsComponentUpdated = /* @__PURE__ */ createDevtoolsComponentHook(
        "component:updated"
        /* COMPONENT_UPDATED */
      );
      var _devtoolsComponentRemoved = /* @__PURE__ */ createDevtoolsComponentHook(
        "component:removed"
        /* COMPONENT_REMOVED */
      );
      var devtoolsComponentRemoved = (component) => {
        if (devtools$1 && typeof devtools$1.cleanupBuffer === "function" && // remove the component if it wasn't buffered
        !devtools$1.cleanupBuffer(component)) {
          _devtoolsComponentRemoved(component);
        }
      };
      // @__NO_SIDE_EFFECTS__
      function createDevtoolsComponentHook(hook) {
        return (component) => {
          emit$1(
            hook,
            component.appContext.app,
            component.uid,
            component.parent ? component.parent.uid : void 0,
            component
          );
        };
      }
      var devtoolsPerfStart = /* @__PURE__ */ createDevtoolsPerformanceHook(
        "perf:start"
        /* PERFORMANCE_START */
      );
      var devtoolsPerfEnd = /* @__PURE__ */ createDevtoolsPerformanceHook(
        "perf:end"
        /* PERFORMANCE_END */
      );
      function createDevtoolsPerformanceHook(hook) {
        return (component, type, time) => {
          emit$1(hook, component.appContext.app, component.uid, component, type, time);
        };
      }
      function devtoolsComponentEmit(component, event, params) {
        emit$1(
          "component:emit",
          component.appContext.app,
          component,
          event,
          params
        );
      }
      var currentRenderingInstance = null;
      var currentScopeId = null;
      function setCurrentRenderingInstance(instance) {
        const prev = currentRenderingInstance;
        currentRenderingInstance = instance;
        currentScopeId = instance && instance.type.__scopeId || null;
        return prev;
      }
      function pushScopeId(id) {
        currentScopeId = id;
      }
      function popScopeId() {
        currentScopeId = null;
      }
      var withScopeId = (_id) => withCtx;
      function withCtx(fn, ctx = currentRenderingInstance, isNonScopedSlot) {
        if (!ctx) return fn;
        if (fn._n) {
          return fn;
        }
        const renderFnWithContext = (...args) => {
          if (renderFnWithContext._d) {
            setBlockTracking(-1);
          }
          const prevInstance = setCurrentRenderingInstance(ctx);
          const prevStackSize = blockStack.length;
          let res;
          try {
            res = fn(...args);
          } finally {
            for (let i = blockStack.length; i > prevStackSize; i--) closeBlock();
            setCurrentRenderingInstance(prevInstance);
            if (renderFnWithContext._d) {
              setBlockTracking(1);
            }
          }
          {
            devtoolsComponentUpdated(ctx);
          }
          return res;
        };
        renderFnWithContext._n = true;
        renderFnWithContext._c = true;
        renderFnWithContext._d = true;
        return renderFnWithContext;
      }
      function validateDirectiveName(name) {
        if (shared.isBuiltInDirective(name)) {
          warn$1("Do not use built-in directive ids as custom directive id: " + name);
        }
      }
      function withDirectives(vnode, directives) {
        if (currentRenderingInstance === null) {
          warn$1(`withDirectives can only be used inside render functions.`);
          return vnode;
        }
        const instance = getComponentPublicInstance(currentRenderingInstance);
        const bindings = vnode.dirs || (vnode.dirs = []);
        for (let i = 0; i < directives.length; i++) {
          let [dir, value, arg, modifiers = shared.EMPTY_OBJ] = directives[i];
          if (dir) {
            if (shared.isFunction(dir)) {
              dir = {
                mounted: dir,
                updated: dir
              };
            }
            if (dir.deep) {
              reactivity.traverse(value);
            }
            bindings.push({
              dir,
              instance,
              value,
              oldValue: void 0,
              arg,
              modifiers
            });
          }
        }
        return vnode;
      }
      function invokeDirectiveHook(vnode, prevVNode, instance, name) {
        const bindings = vnode.dirs;
        const oldBindings = prevVNode && prevVNode.dirs;
        for (let i = 0; i < bindings.length; i++) {
          const binding = bindings[i];
          if (oldBindings) {
            binding.oldValue = oldBindings[i].value;
          }
          let hook = binding.dir[name];
          if (hook) {
            reactivity.pauseTracking();
            callWithAsyncErrorHandling(hook, instance, 8, [
              vnode.el,
              binding,
              vnode,
              prevVNode
            ]);
            reactivity.resetTracking();
          }
        }
      }
      function provide(key, value) {
        {
          if (!currentInstance || currentInstance.isMounted) {
            warn$1(`provide() can only be used inside setup().`);
          }
        }
        if (currentInstance) {
          let provides = currentInstance.provides;
          const parentProvides = currentInstance.parent && currentInstance.parent.provides;
          if (parentProvides === provides) {
            provides = currentInstance.provides = Object.create(parentProvides);
          }
          provides[key] = value;
        }
      }
      function inject(key, defaultValue, treatDefaultAsFactory = false) {
        const instance = getCurrentInstance();
        if (instance || currentApp) {
          let provides = currentApp ? currentApp._context.provides : instance ? instance.parent == null || instance.ce ? instance.vnode.appContext && instance.vnode.appContext.provides : instance.parent.provides : void 0;
          if (provides && key in provides) {
            return provides[key];
          } else if (arguments.length > 1) {
            return treatDefaultAsFactory && shared.isFunction(defaultValue) ? defaultValue.call(instance && instance.proxy) : defaultValue;
          } else {
            warn$1(`injection "${String(key)}" not found.`);
          }
        } else {
          warn$1(`inject() can only be used inside setup() or functional components.`);
        }
      }
      function hasInjectionContext() {
        return !!(getCurrentInstance() || currentApp);
      }
      var ssrContextKey = /* @__PURE__ */ Symbol.for("v-scx");
      var useSSRContext = () => {
        {
          const ctx = inject(ssrContextKey);
          if (!ctx) {
            warn$1(
              `Server rendering context not provided. Make sure to only call useSSRContext() conditionally in the server build.`
            );
          }
          return ctx;
        }
      };
      function watchEffect(effect, options) {
        return doWatch(effect, null, options);
      }
      function watchPostEffect(effect, options) {
        return doWatch(
          effect,
          null,
          shared.extend({}, options, { flush: "post" })
        );
      }
      function watchSyncEffect(effect, options) {
        return doWatch(
          effect,
          null,
          shared.extend({}, options, { flush: "sync" })
        );
      }
      function watch(source, cb, options) {
        if (!shared.isFunction(cb)) {
          warn$1(
            `\`watch(fn, options?)\` signature has been moved to a separate API. Use \`watchEffect(fn, options?)\` instead. \`watch\` now only supports \`watch(source, cb, options?) signature.`
          );
        }
        return doWatch(source, cb, options);
      }
      function doWatch(source, cb, options = shared.EMPTY_OBJ) {
        const { immediate, deep, flush, once } = options;
        if (!cb) {
          if (immediate !== void 0) {
            warn$1(
              `watch() "immediate" option is only respected when using the watch(source, callback, options?) signature.`
            );
          }
          if (deep !== void 0) {
            warn$1(
              `watch() "deep" option is only respected when using the watch(source, callback, options?) signature.`
            );
          }
          if (once !== void 0) {
            warn$1(
              `watch() "once" option is only respected when using the watch(source, callback, options?) signature.`
            );
          }
        }
        const baseWatchOptions = shared.extend({}, options);
        baseWatchOptions.onWarn = warn$1;
        const runsImmediately = cb && immediate || !cb && flush !== "post";
        let ssrCleanup;
        if (isInSSRComponentSetup) {
          if (flush === "sync") {
            const ctx = useSSRContext();
            ssrCleanup = ctx.__watcherHandles || (ctx.__watcherHandles = []);
          } else if (!runsImmediately) {
            const watchStopHandle = () => {
            };
            watchStopHandle.stop = shared.NOOP;
            watchStopHandle.resume = shared.NOOP;
            watchStopHandle.pause = shared.NOOP;
            return watchStopHandle;
          }
        }
        const instance = currentInstance;
        baseWatchOptions.call = (fn, type, args) => callWithAsyncErrorHandling(fn, instance, type, args);
        let isPre = false;
        if (flush === "post") {
          baseWatchOptions.scheduler = (job) => {
            queuePostRenderEffect(job, instance && instance.suspense);
          };
        } else if (flush !== "sync") {
          isPre = true;
          baseWatchOptions.scheduler = (job, isFirstRun) => {
            if (isFirstRun) {
              job();
            } else {
              queueJob(job);
            }
          };
        }
        baseWatchOptions.augmentJob = (job) => {
          if (cb) {
            job.flags |= 4;
          }
          if (isPre) {
            job.flags |= 2;
            if (instance) {
              job.id = instance.uid;
              job.i = instance;
            }
          }
        };
        const watchHandle = reactivity.watch(source, cb, baseWatchOptions);
        if (isInSSRComponentSetup) {
          if (ssrCleanup) {
            ssrCleanup.push(watchHandle);
          } else if (runsImmediately) {
            watchHandle();
          }
        }
        return watchHandle;
      }
      function instanceWatch(source, value, options) {
        const publicThis = this.proxy;
        const getter = shared.isString(source) ? source.includes(".") ? createPathGetter(publicThis, source) : () => publicThis[source] : source.bind(publicThis, publicThis);
        let cb;
        if (shared.isFunction(value)) {
          cb = value;
        } else {
          cb = value.handler;
          options = value;
        }
        const reset = setCurrentInstance(this);
        const res = doWatch(getter, cb.bind(publicThis), options);
        reset();
        return res;
      }
      function createPathGetter(ctx, path) {
        const segments = path.split(".");
        return () => {
          let cur = ctx;
          for (let i = 0; i < segments.length && cur; i++) {
            cur = cur[segments[i]];
          }
          return cur;
        };
      }
      var pendingMounts = /* @__PURE__ */ new WeakMap();
      var TeleportEndKey = /* @__PURE__ */ Symbol("_vte");
      var isTeleport = (type) => type.__isTeleport;
      var isTeleportDisabled = (props) => props && (props.disabled || props.disabled === "");
      var isTeleportDeferred = (props) => props && (props.defer || props.defer === "");
      var isTargetSVG = (target) => typeof SVGElement !== "undefined" && target instanceof SVGElement;
      var isTargetMathML = (target) => typeof MathMLElement === "function" && target instanceof MathMLElement;
      var resolveTarget = (props, select) => {
        const targetSelector = props && props.to;
        if (shared.isString(targetSelector)) {
          if (!select) {
            warn$1(
              `Current renderer does not support string target for Teleports. (missing querySelector renderer option)`
            );
            return null;
          } else {
            const target = select(targetSelector);
            if (!target && !isTeleportDisabled(props)) {
              warn$1(
                `Failed to locate Teleport target with selector "${targetSelector}". Note the target element must exist before the component is mounted - i.e. the target cannot be rendered by the component itself, and ideally should be outside of the entire Vue component tree.`
              );
            }
            return target;
          }
        } else {
          if (!targetSelector && !isTeleportDisabled(props)) {
            warn$1(`Invalid Teleport target: ${targetSelector}`);
          }
          return targetSelector;
        }
      };
      var TeleportImpl = {
        name: "Teleport",
        __isTeleport: true,
        process(n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized, internals) {
          const {
            mc: mountChildren,
            pc: patchChildren,
            pbc: patchBlockChildren,
            o: { insert: insert2, querySelector, createText, createComment, parentNode }
          } = internals;
          const disabled = isTeleportDisabled(n2.props);
          let { dynamicChildren } = n2;
          if (isHmrUpdating) {
            optimized = false;
            dynamicChildren = null;
          }
          const mount = (vnode, container2, anchor2) => {
            if (vnode.shapeFlag & 16) {
              mountChildren(
                vnode.children,
                container2,
                anchor2,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
            }
          };
          const mountToTarget = (vnode = n2) => {
            const disabled2 = isTeleportDisabled(vnode.props);
            const target = vnode.target = resolveTarget(vnode.props, querySelector);
            const targetAnchor = prepareAnchor(target, vnode, createText, insert2);
            if (target) {
              if (namespace !== "svg" && isTargetSVG(target)) {
                namespace = "svg";
              } else if (namespace !== "mathml" && isTargetMathML(target)) {
                namespace = "mathml";
              }
              if (parentComponent && parentComponent.isCE) {
                (parentComponent.ce._teleportTargets || (parentComponent.ce._teleportTargets = /* @__PURE__ */ new Set())).add(target);
              }
              if (!disabled2) {
                mount(vnode, target, targetAnchor);
                updateCssVars(vnode, false);
              }
            } else if (!disabled2) {
              warn$1("Invalid Teleport target on mount:", target, `(${typeof target})`);
            }
          };
          const queuePendingMount = (vnode) => {
            const mountJob = () => {
              if (pendingMounts.get(vnode) !== mountJob) return;
              pendingMounts.delete(vnode);
              if (isTeleportDisabled(vnode.props)) {
                const mountContainer = parentNode(vnode.el) || container;
                mount(vnode, mountContainer, vnode.anchor);
                updateCssVars(vnode, true);
              }
              mountToTarget(vnode);
            };
            pendingMounts.set(vnode, mountJob);
            queuePostRenderEffect(mountJob, parentSuspense);
          };
          if (n1 == null) {
            const placeholder = n2.el = createComment("teleport start");
            const mainAnchor = n2.anchor = createComment("teleport end");
            insert2(placeholder, container, anchor);
            insert2(mainAnchor, container, anchor);
            if (isTeleportDeferred(n2.props) || parentSuspense && parentSuspense.pendingBranch) {
              queuePendingMount(n2);
              return;
            }
            if (disabled) {
              mount(n2, container, mainAnchor);
              updateCssVars(n2, true);
            }
            mountToTarget();
          } else {
            n2.el = n1.el;
            const mainAnchor = n2.anchor = n1.anchor;
            const pendingMount = pendingMounts.get(n1);
            if (pendingMount) {
              pendingMount.flags |= 8;
              pendingMounts.delete(n1);
              queuePendingMount(n2);
              return;
            }
            n2.targetStart = n1.targetStart;
            const target = n2.target = n1.target;
            const targetAnchor = n2.targetAnchor = n1.targetAnchor;
            const wasDisabled = isTeleportDisabled(n1.props);
            const currentContainer = wasDisabled ? container : target;
            const currentAnchor = wasDisabled ? mainAnchor : targetAnchor;
            if (namespace === "svg" || isTargetSVG(target)) {
              namespace = "svg";
            } else if (namespace === "mathml" || isTargetMathML(target)) {
              namespace = "mathml";
            }
            if (dynamicChildren) {
              patchBlockChildren(
                n1.dynamicChildren,
                dynamicChildren,
                currentContainer,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds
              );
              traverseStaticChildren(n1, n2, false);
            } else if (!optimized) {
              patchChildren(
                n1,
                n2,
                currentContainer,
                currentAnchor,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                false
              );
            }
            if (disabled) {
              if (!wasDisabled) {
                moveTeleport(
                  n2,
                  container,
                  mainAnchor,
                  internals,
                  1
                );
              } else {
                if (n2.props && n1.props && n2.props.to !== n1.props.to) {
                  n2.props.to = n1.props.to;
                }
              }
            } else {
              if ((n2.props && n2.props.to) !== (n1.props && n1.props.to)) {
                const nextTarget = resolveTarget(n2.props, querySelector);
                if (nextTarget) {
                  n2.target = nextTarget;
                  moveTeleport(
                    n2,
                    nextTarget,
                    null,
                    internals,
                    0
                  );
                } else {
                  warn$1(
                    "Invalid Teleport target on update:",
                    target,
                    `(${typeof target})`
                  );
                }
              } else if (wasDisabled) {
                moveTeleport(
                  n2,
                  target,
                  targetAnchor,
                  internals,
                  1
                );
              }
            }
            updateCssVars(n2, disabled);
          }
        },
        remove(vnode, parentComponent, parentSuspense, { um: unmount, o: { remove: hostRemove } }, doRemove) {
          const {
            shapeFlag,
            children,
            anchor,
            targetStart,
            targetAnchor,
            target,
            props
          } = vnode;
          const disabled = isTeleportDisabled(props);
          const shouldRemove = doRemove || !disabled;
          const pendingMount = pendingMounts.get(vnode);
          if (pendingMount) {
            pendingMount.flags |= 8;
            pendingMounts.delete(vnode);
          }
          if (target) {
            hostRemove(targetStart);
            hostRemove(targetAnchor);
          }
          doRemove && hostRemove(anchor);
          if (!pendingMount && (disabled || target) && shapeFlag & 16) {
            for (let i = 0; i < children.length; i++) {
              const child = children[i];
              unmount(
                child,
                parentComponent,
                parentSuspense,
                shouldRemove,
                !!child.dynamicChildren
              );
            }
          }
        },
        move: moveTeleport,
        hydrate: hydrateTeleport
      };
      function moveTeleport(vnode, container, parentAnchor, { o: { insert: insert2 }, m: move }, moveType = 2) {
        if (moveType === 0) {
          insert2(vnode.targetAnchor, container, parentAnchor);
        }
        const { el, anchor, shapeFlag, children, props } = vnode;
        const isReorder = moveType === 2;
        if (isReorder) {
          insert2(el, container, parentAnchor);
        }
        if (!pendingMounts.has(vnode) && (!isReorder || isTeleportDisabled(props))) {
          if (shapeFlag & 16) {
            for (let i = 0; i < children.length; i++) {
              move(
                children[i],
                container,
                parentAnchor,
                2
              );
            }
          }
        }
        if (isReorder) {
          insert2(anchor, container, parentAnchor);
        }
      }
      function hydrateTeleport(node, vnode, parentComponent, parentSuspense, slotScopeIds, optimized, {
        o: { nextSibling, parentNode, querySelector, insert: insert2, createText }
      }, hydrateChildren) {
        function hydrateAnchor(target2, targetNode) {
          let targetAnchor = targetNode;
          while (targetAnchor) {
            if (targetAnchor && targetAnchor.nodeType === 8) {
              if (targetAnchor.data === "teleport start anchor") {
                vnode.targetStart = targetAnchor;
              } else if (targetAnchor.data === "teleport anchor") {
                vnode.targetAnchor = targetAnchor;
                target2._lpa = vnode.targetAnchor && nextSibling(vnode.targetAnchor);
                break;
              }
            }
            targetAnchor = nextSibling(targetAnchor);
          }
        }
        function hydrateDisabledTeleport(node2, vnode2) {
          vnode2.anchor = hydrateChildren(
            nextSibling(node2),
            vnode2,
            parentNode(node2),
            parentComponent,
            parentSuspense,
            slotScopeIds,
            optimized
          );
        }
        const target = vnode.target = resolveTarget(
          vnode.props,
          querySelector
        );
        const disabled = isTeleportDisabled(vnode.props);
        if (target) {
          const targetNode = target._lpa || target.firstChild;
          if (vnode.shapeFlag & 16) {
            if (disabled) {
              hydrateDisabledTeleport(node, vnode);
              hydrateAnchor(target, targetNode);
              if (!vnode.targetAnchor) {
                prepareAnchor(
                  target,
                  vnode,
                  createText,
                  insert2,
                  // if target is the same as the main view, insert anchors before current node
                  // to avoid hydrating mismatch
                  parentNode(node) === target ? node : null
                );
              }
            } else {
              vnode.anchor = nextSibling(node);
              hydrateAnchor(target, targetNode);
              if (!vnode.targetAnchor) {
                prepareAnchor(target, vnode, createText, insert2);
              }
              hydrateChildren(
                targetNode && nextSibling(targetNode),
                vnode,
                target,
                parentComponent,
                parentSuspense,
                slotScopeIds,
                optimized
              );
            }
          }
          updateCssVars(vnode, disabled);
        } else if (disabled) {
          if (vnode.shapeFlag & 16) {
            hydrateDisabledTeleport(node, vnode);
            vnode.targetStart = node;
            vnode.targetAnchor = nextSibling(node);
          }
        }
        return vnode.anchor && nextSibling(vnode.anchor);
      }
      var Teleport = TeleportImpl;
      function updateCssVars(vnode, isDisabled) {
        const ctx = vnode.ctx;
        if (ctx && ctx.ut) {
          let node, anchor;
          if (isDisabled) {
            node = vnode.el;
            anchor = vnode.anchor;
          } else {
            node = vnode.targetStart;
            anchor = vnode.targetAnchor;
          }
          while (node && node !== anchor) {
            if (node.nodeType === 1) node.setAttribute("data-v-owner", ctx.uid);
            node = node.nextSibling;
          }
          ctx.ut();
        }
      }
      function prepareAnchor(target, vnode, createText, insert2, anchor = null) {
        const targetStart = vnode.targetStart = createText("");
        const targetAnchor = vnode.targetAnchor = createText("");
        targetStart[TeleportEndKey] = targetAnchor;
        if (target) {
          insert2(targetStart, target, anchor);
          insert2(targetAnchor, target, anchor);
        }
        return targetAnchor;
      }
      var leaveCbKey = /* @__PURE__ */ Symbol("_leaveCb");
      var enterCbKey = /* @__PURE__ */ Symbol("_enterCb");
      function useTransitionState() {
        const state = {
          isMounted: false,
          isLeaving: false,
          isUnmounting: false,
          leavingVNodes: /* @__PURE__ */ new Map()
        };
        onMounted(() => {
          state.isMounted = true;
        });
        onBeforeUnmount(() => {
          state.isUnmounting = true;
        });
        return state;
      }
      var TransitionHookValidator = [Function, Array];
      var BaseTransitionPropsValidators = {
        mode: String,
        appear: Boolean,
        persisted: Boolean,
        // enter
        onBeforeEnter: TransitionHookValidator,
        onEnter: TransitionHookValidator,
        onAfterEnter: TransitionHookValidator,
        onEnterCancelled: TransitionHookValidator,
        // leave
        onBeforeLeave: TransitionHookValidator,
        onLeave: TransitionHookValidator,
        onAfterLeave: TransitionHookValidator,
        onLeaveCancelled: TransitionHookValidator,
        // appear
        onBeforeAppear: TransitionHookValidator,
        onAppear: TransitionHookValidator,
        onAfterAppear: TransitionHookValidator,
        onAppearCancelled: TransitionHookValidator
      };
      var recursiveGetSubtree = (instance) => {
        const subTree = instance.subTree;
        return subTree.component ? recursiveGetSubtree(subTree.component) : subTree;
      };
      var BaseTransitionImpl = {
        name: `BaseTransition`,
        props: BaseTransitionPropsValidators,
        setup(props, { slots }) {
          const instance = getCurrentInstance();
          const state = useTransitionState();
          return () => {
            const children = slots.default && getTransitionRawChildren(slots.default(), true);
            const child = children && children.length ? findNonCommentChild(children) : (
              // Keep explicit default-slot conditionals on the same transition path
              // as regular v-if branches, which render a comment placeholder.
              instance.subTree ? createCommentVNode() : void 0
            );
            if (!child) {
              return;
            }
            const rawProps = reactivity.toRaw(props);
            const { mode } = rawProps;
            if (mode && mode !== "in-out" && mode !== "out-in" && mode !== "default") {
              warn$1(`invalid <transition> mode: ${mode}`);
            }
            if (state.isLeaving) {
              return emptyPlaceholder(child);
            }
            const innerChild = getInnerChild$1(child);
            if (!innerChild) {
              return emptyPlaceholder(child);
            }
            let enterHooks = resolveTransitionHooks(
              innerChild,
              rawProps,
              state,
              instance,
              // #11061, ensure enterHooks is fresh after clone
              (hooks) => enterHooks = hooks
            );
            if (innerChild.type !== Comment) {
              setTransitionHooks(innerChild, enterHooks);
            }
            let oldInnerChild = instance.subTree && getInnerChild$1(instance.subTree);
            if (oldInnerChild && oldInnerChild.type !== Comment && !isSameVNodeType(oldInnerChild, innerChild) && recursiveGetSubtree(instance).type !== Comment) {
              let leavingHooks = resolveTransitionHooks(
                oldInnerChild,
                rawProps,
                state,
                instance
              );
              setTransitionHooks(oldInnerChild, leavingHooks);
              if (mode === "out-in" && innerChild.type !== Comment) {
                state.isLeaving = true;
                leavingHooks.afterLeave = () => {
                  state.isLeaving = false;
                  if (!(instance.job.flags & 8)) {
                    instance.update();
                  }
                  delete leavingHooks.afterLeave;
                  oldInnerChild = void 0;
                };
                return emptyPlaceholder(child);
              } else if (mode === "in-out" && innerChild.type !== Comment) {
                leavingHooks.delayLeave = (el, earlyRemove, delayedLeave) => {
                  const leavingVNodesCache = getLeavingNodesForType(
                    state,
                    oldInnerChild
                  );
                  leavingVNodesCache[String(oldInnerChild.key)] = oldInnerChild;
                  el[leaveCbKey] = () => {
                    earlyRemove();
                    el[leaveCbKey] = void 0;
                    delete enterHooks.delayedLeave;
                    oldInnerChild = void 0;
                  };
                  enterHooks.delayedLeave = () => {
                    delayedLeave();
                    delete enterHooks.delayedLeave;
                    oldInnerChild = void 0;
                  };
                };
              } else {
                oldInnerChild = void 0;
              }
            } else if (oldInnerChild) {
              oldInnerChild = void 0;
            }
            return child;
          };
        }
      };
      function findNonCommentChild(children) {
        let child = children[0];
        if (children.length > 1) {
          let hasFound = false;
          for (const c of children) {
            if (c.type !== Comment) {
              if (hasFound) {
                warn$1(
                  "<transition> can only be used on a single element or component. Use <transition-group> for lists."
                );
                break;
              }
              child = c;
              hasFound = true;
            }
          }
        }
        return child;
      }
      var BaseTransition = BaseTransitionImpl;
      function getLeavingNodesForType(state, vnode) {
        const { leavingVNodes } = state;
        let leavingVNodesCache = leavingVNodes.get(vnode.type);
        if (!leavingVNodesCache) {
          leavingVNodesCache = /* @__PURE__ */ Object.create(null);
          leavingVNodes.set(vnode.type, leavingVNodesCache);
        }
        return leavingVNodesCache;
      }
      function resolveTransitionHooks(vnode, props, state, instance, postClone) {
        const {
          appear,
          mode,
          persisted = false,
          onBeforeEnter,
          onEnter,
          onAfterEnter,
          onEnterCancelled,
          onBeforeLeave,
          onLeave,
          onAfterLeave,
          onLeaveCancelled,
          onBeforeAppear,
          onAppear,
          onAfterAppear,
          onAppearCancelled
        } = props;
        const key = String(vnode.key);
        const leavingVNodesCache = getLeavingNodesForType(state, vnode);
        const callHook2 = (hook, args) => {
          hook && callWithAsyncErrorHandling(
            hook,
            instance,
            9,
            args
          );
        };
        const callAsyncHook = (hook, args) => {
          const done = args[1];
          callHook2(hook, args);
          if (shared.isArray(hook)) {
            if (hook.every((hook2) => hook2.length <= 1)) done();
          } else if (hook.length <= 1) {
            done();
          }
        };
        const hooks = {
          mode,
          persisted,
          beforeEnter(el) {
            let hook = onBeforeEnter;
            if (!state.isMounted) {
              if (appear) {
                hook = onBeforeAppear || onBeforeEnter;
              } else {
                return;
              }
            }
            if (el[leaveCbKey]) {
              el[leaveCbKey](
                true
                /* cancelled */
              );
            }
            const leavingVNode = leavingVNodesCache[key];
            if (leavingVNode && isSameVNodeType(vnode, leavingVNode) && leavingVNode.el[leaveCbKey]) {
              leavingVNode.el[leaveCbKey]();
            }
            callHook2(hook, [el]);
          },
          enter(el) {
            if (!isHmrUpdating && leavingVNodesCache[key] === vnode) return;
            let hook = onEnter;
            let afterHook = onAfterEnter;
            let cancelHook = onEnterCancelled;
            if (!state.isMounted) {
              if (appear) {
                hook = onAppear || onEnter;
                afterHook = onAfterAppear || onAfterEnter;
                cancelHook = onAppearCancelled || onEnterCancelled;
              } else {
                return;
              }
            }
            let called = false;
            el[enterCbKey] = (cancelled) => {
              if (called) return;
              called = true;
              if (cancelled) {
                callHook2(cancelHook, [el]);
              } else {
                callHook2(afterHook, [el]);
              }
              if (hooks.delayedLeave) {
                hooks.delayedLeave();
              }
              el[enterCbKey] = void 0;
            };
            const done = el[enterCbKey].bind(null, false);
            if (hook) {
              callAsyncHook(hook, [el, done]);
            } else {
              done();
            }
          },
          leave(el, remove2) {
            const key2 = String(vnode.key);
            if (el[enterCbKey]) {
              el[enterCbKey](
                true
                /* cancelled */
              );
            }
            if (state.isUnmounting) {
              return remove2();
            }
            callHook2(onBeforeLeave, [el]);
            let called = false;
            el[leaveCbKey] = (cancelled) => {
              if (called) return;
              called = true;
              remove2();
              if (cancelled) {
                callHook2(onLeaveCancelled, [el]);
              } else {
                callHook2(onAfterLeave, [el]);
              }
              el[leaveCbKey] = void 0;
              if (leavingVNodesCache[key2] === vnode) {
                delete leavingVNodesCache[key2];
              }
            };
            const done = el[leaveCbKey].bind(null, false);
            leavingVNodesCache[key2] = vnode;
            if (onLeave) {
              callAsyncHook(onLeave, [el, done]);
            } else {
              done();
            }
          },
          clone(vnode2) {
            const hooks2 = resolveTransitionHooks(
              vnode2,
              props,
              state,
              instance,
              postClone
            );
            if (postClone) postClone(hooks2);
            return hooks2;
          }
        };
        return hooks;
      }
      function emptyPlaceholder(vnode) {
        if (isKeepAlive(vnode)) {
          vnode = cloneVNode(vnode);
          vnode.children = null;
          return vnode;
        }
      }
      function getInnerChild$1(vnode) {
        if (!isKeepAlive(vnode)) {
          if (isTeleport(vnode.type) && vnode.children) {
            return findNonCommentChild(vnode.children);
          }
          return vnode;
        }
        if (vnode.component) {
          return vnode.component.subTree;
        }
        const { shapeFlag, children } = vnode;
        if (children) {
          if (shapeFlag & 16) {
            return children[0];
          }
          if (shapeFlag & 32 && shared.isFunction(children.default)) {
            return children.default();
          }
        }
      }
      function setTransitionHooks(vnode, hooks) {
        if (vnode.shapeFlag & 6 && vnode.component) {
          vnode.transition = hooks;
          const subTree = vnode.component.subTree;
          setTransitionHooks(
            isTeleport(subTree.type) ? getInnerChild$1(subTree) || subTree : subTree,
            hooks
          );
        } else if (vnode.shapeFlag & 128) {
          vnode.ssContent.transition = hooks.clone(vnode.ssContent);
          vnode.ssFallback.transition = hooks.clone(vnode.ssFallback);
        } else {
          vnode.transition = hooks;
        }
      }
      function getTransitionRawChildren(children, keepComment = false, parentKey) {
        let ret = [];
        let keyedFragmentCount = 0;
        for (let i = 0; i < children.length; i++) {
          let child = children[i];
          const key = parentKey == null ? child.key : String(parentKey) + String(child.key != null ? child.key : i);
          if (child.type === Fragment) {
            if (child.patchFlag & 128) keyedFragmentCount++;
            ret = ret.concat(
              getTransitionRawChildren(child.children, keepComment, key)
            );
          } else if (keepComment || child.type !== Comment) {
            ret.push(key != null ? cloneVNode(child, { key }) : child);
          }
        }
        if (keyedFragmentCount > 1) {
          for (let i = 0; i < ret.length; i++) {
            ret[i].patchFlag = -2;
          }
        }
        return ret;
      }
      // @__NO_SIDE_EFFECTS__
      function defineComponent2(options, extraOptions) {
        return shared.isFunction(options) ? (
          // #8236: extend call and options.name access are considered side-effects
          // by Rollup, so we have to wrap it in a pure-annotated IIFE.
          /* @__PURE__ */ (() => shared.extend({ name: options.name }, extraOptions, { setup: options }))()
        ) : options;
      }
      function useId() {
        const i = getCurrentInstance();
        if (i) {
          return (i.appContext.config.idPrefix || "v") + "-" + i.ids[0] + i.ids[1]++;
        } else {
          warn$1(
            `useId() is called when there is no active component instance to be associated with.`
          );
        }
        return "";
      }
      function markAsyncBoundary(instance) {
        instance.ids = [instance.ids[0] + instance.ids[2]++ + "-", 0, 0];
      }
      var knownTemplateRefs = /* @__PURE__ */ new WeakSet();
      function useTemplateRef(key) {
        const i = getCurrentInstance();
        const r = reactivity.shallowRef(null);
        if (i) {
          const refs = i.refs === shared.EMPTY_OBJ ? i.refs = {} : i.refs;
          if (isTemplateRefKey(refs, key)) {
            warn$1(`useTemplateRef('${key}') already exists.`);
          } else {
            Object.defineProperty(refs, key, {
              enumerable: true,
              get: () => r.value,
              set: (val) => r.value = val
            });
          }
        } else {
          warn$1(
            `useTemplateRef() is called when there is no active component instance to be associated with.`
          );
        }
        const ret = reactivity.readonly(r);
        {
          knownTemplateRefs.add(ret);
        }
        return ret;
      }
      function isTemplateRefKey(refs, key) {
        let desc;
        return !!((desc = Object.getOwnPropertyDescriptor(refs, key)) && !desc.configurable);
      }
      var pendingSetRefMap = /* @__PURE__ */ new WeakMap();
      function setRef(rawRef, oldRawRef, parentSuspense, vnode, isUnmount = false) {
        if (shared.isArray(rawRef)) {
          rawRef.forEach(
            (r, i) => setRef(
              r,
              oldRawRef && (shared.isArray(oldRawRef) ? oldRawRef[i] : oldRawRef),
              parentSuspense,
              vnode,
              isUnmount
            )
          );
          return;
        }
        if (isAsyncWrapper(vnode) && !isUnmount) {
          if (vnode.shapeFlag & 512 && vnode.type.__asyncResolved && vnode.component.subTree.component) {
            setRef(rawRef, oldRawRef, parentSuspense, vnode.component.subTree);
          }
          return;
        }
        const refValue = vnode.shapeFlag & 4 ? getComponentPublicInstance(vnode.component) : vnode.el;
        const value = isUnmount ? null : refValue;
        const { i: owner, r: ref } = rawRef;
        if (!owner) {
          warn$1(
            `Missing ref owner context. ref cannot be used on hoisted vnodes. A vnode with ref must be created inside the render function.`
          );
          return;
        }
        const oldRef = oldRawRef && oldRawRef.r;
        const refs = owner.refs === shared.EMPTY_OBJ ? owner.refs = {} : owner.refs;
        const setupState = owner.setupState;
        const rawSetupState = reactivity.toRaw(setupState);
        const canSetSetupRef = setupState === shared.EMPTY_OBJ ? shared.NO : (key) => {
          {
            if (shared.hasOwn(rawSetupState, key) && !reactivity.isRef(rawSetupState[key])) {
              warn$1(
                `Template ref "${key}" used on a non-ref value. It will not work in the production build.`
              );
            }
            if (knownTemplateRefs.has(rawSetupState[key])) {
              return false;
            }
          }
          if (isTemplateRefKey(refs, key)) {
            return false;
          }
          return shared.hasOwn(rawSetupState, key);
        };
        const canSetRef = (ref2, key) => {
          if (knownTemplateRefs.has(ref2)) {
            return false;
          }
          if (key && isTemplateRefKey(refs, key)) {
            return false;
          }
          return true;
        };
        if (oldRef != null && oldRef !== ref) {
          invalidatePendingSetRef(oldRawRef);
          if (shared.isString(oldRef)) {
            refs[oldRef] = null;
            if (canSetSetupRef(oldRef)) {
              setupState[oldRef] = null;
            }
          } else if (reactivity.isRef(oldRef)) {
            const oldRawRefAtom = oldRawRef;
            if (canSetRef(oldRef, oldRawRefAtom.k)) {
              oldRef.value = null;
            }
            if (oldRawRefAtom.k) refs[oldRawRefAtom.k] = null;
          }
        }
        if (shared.isFunction(ref)) {
          callWithErrorHandling(ref, owner, 12, [value, refs]);
        } else {
          const _isString = shared.isString(ref);
          const _isRef = reactivity.isRef(ref);
          if (_isString || _isRef) {
            const doSet = () => {
              if (rawRef.f) {
                const existing = _isString ? canSetSetupRef(ref) ? setupState[ref] : refs[ref] : canSetRef(ref) || !rawRef.k ? ref.value : refs[rawRef.k];
                if (isUnmount) {
                  shared.isArray(existing) && shared.remove(existing, refValue);
                } else {
                  if (!shared.isArray(existing)) {
                    if (_isString) {
                      refs[ref] = [refValue];
                      if (canSetSetupRef(ref)) {
                        setupState[ref] = refs[ref];
                      }
                    } else {
                      const newVal = [refValue];
                      if (canSetRef(ref, rawRef.k)) {
                        ref.value = newVal;
                      }
                      if (rawRef.k) refs[rawRef.k] = newVal;
                    }
                  } else if (!existing.includes(refValue)) {
                    existing.push(refValue);
                  }
                }
              } else if (_isString) {
                refs[ref] = value;
                if (canSetSetupRef(ref)) {
                  setupState[ref] = value;
                }
              } else if (_isRef) {
                if (canSetRef(ref, rawRef.k)) {
                  ref.value = value;
                }
                if (rawRef.k) refs[rawRef.k] = value;
              } else {
                warn$1("Invalid template ref type:", ref, `(${typeof ref})`);
              }
            };
            if (value) {
              const job = () => {
                doSet();
                pendingSetRefMap.delete(rawRef);
              };
              job.id = -1;
              pendingSetRefMap.set(rawRef, job);
              queuePostRenderEffect(job, parentSuspense);
            } else {
              invalidatePendingSetRef(rawRef);
              doSet();
            }
          } else {
            warn$1("Invalid template ref type:", ref, `(${typeof ref})`);
          }
        }
      }
      function invalidatePendingSetRef(rawRef) {
        const pendingSetRef = pendingSetRefMap.get(rawRef);
        if (pendingSetRef) {
          pendingSetRef.flags |= 8;
          pendingSetRefMap.delete(rawRef);
        }
      }
      var hasLoggedMismatchError = false;
      var logMismatchError = () => {
        if (hasLoggedMismatchError) {
          return;
        }
        console.error("Hydration completed but contains mismatches.");
        hasLoggedMismatchError = true;
      };
      var isSVGContainer = (container) => container.namespaceURI.includes("svg") && container.tagName !== "foreignObject";
      var isMathMLContainer = (container) => container.namespaceURI.includes("MathML");
      var getContainerType = (container) => {
        if (container.nodeType !== 1) return void 0;
        if (isSVGContainer(container)) return "svg";
        if (isMathMLContainer(container)) return "mathml";
        return void 0;
      };
      var isComment = (node) => node.nodeType === 8;
      function createHydrationFunctions(rendererInternals) {
        const {
          mt: mountComponent,
          p: patch,
          o: {
            patchProp: patchProp2,
            createText,
            nextSibling,
            parentNode,
            remove: remove2,
            insert: insert2,
            createComment
          }
        } = rendererInternals;
        const hydrate = (vnode, container) => {
          if (!container.hasChildNodes()) {
            warn$1(
              `Attempting to hydrate existing markup but container is empty. Performing full mount instead.`
            );
            patch(null, vnode, container);
            flushPostFlushCbs();
            container._vnode = vnode;
            return;
          }
          hydrateNode(container.firstChild, vnode, null, null, null);
          flushPostFlushCbs();
          container._vnode = vnode;
        };
        const hydrateNode = (node, vnode, parentComponent, parentSuspense, slotScopeIds, optimized = false) => {
          optimized = optimized || !!vnode.dynamicChildren;
          const isFragmentStart = isComment(node) && node.data === "[";
          const onMismatch = () => handleMismatch(
            node,
            vnode,
            parentComponent,
            parentSuspense,
            slotScopeIds,
            isFragmentStart
          );
          const { type, ref, shapeFlag, patchFlag } = vnode;
          let domType = node.nodeType;
          vnode.el = node;
          {
            shared.def(node, "__vnode", vnode, true);
            shared.def(node, "__vueParentComponent", parentComponent, true);
          }
          if (patchFlag === -2) {
            optimized = false;
            vnode.dynamicChildren = null;
          }
          let nextNode = null;
          switch (type) {
            case Text:
              if (domType !== 3) {
                if (vnode.children === "") {
                  insert2(vnode.el = createText(""), parentNode(node), node);
                  nextNode = node;
                } else {
                  nextNode = onMismatch();
                }
              } else {
                if (node.data !== vnode.children) {
                  warn$1(
                    `Hydration text mismatch in`,
                    node.parentNode,
                    `
  - rendered on server: ${JSON.stringify(
                      node.data
                    )}
  - expected on client: ${JSON.stringify(vnode.children)}`
                  );
                  logMismatchError();
                  node.data = vnode.children;
                }
                nextNode = nextSibling(node);
              }
              break;
            case Comment:
              if (isTemplateNode(node)) {
                nextNode = nextSibling(node);
                replaceNode(
                  vnode.el = node.content.firstChild,
                  node,
                  parentComponent
                );
              } else if (domType !== 8 || isFragmentStart) {
                nextNode = onMismatch();
              } else {
                nextNode = nextSibling(node);
              }
              break;
            case Static:
              if (isFragmentStart) {
                node = nextSibling(node);
                domType = node.nodeType;
              }
              if (domType === 1 || domType === 3) {
                nextNode = node;
                const needToAdoptContent = !vnode.children.length;
                for (let i = 0; i < vnode.staticCount; i++) {
                  if (needToAdoptContent)
                    vnode.children += nextNode.nodeType === 1 ? nextNode.outerHTML : nextNode.data;
                  if (i === vnode.staticCount - 1) {
                    vnode.anchor = nextNode;
                  }
                  nextNode = nextSibling(nextNode);
                }
                return isFragmentStart ? nextSibling(nextNode) : nextNode;
              } else {
                onMismatch();
              }
              break;
            case Fragment:
              if (!isFragmentStart) {
                nextNode = onMismatch();
              } else {
                nextNode = hydrateFragment(
                  node,
                  vnode,
                  parentComponent,
                  parentSuspense,
                  slotScopeIds,
                  optimized
                );
              }
              break;
            default:
              if (shapeFlag & 1) {
                if ((domType !== 1 || vnode.type.toLowerCase() !== node.tagName.toLowerCase()) && !isTemplateNode(node)) {
                  nextNode = onMismatch();
                } else {
                  nextNode = hydrateElement(
                    node,
                    vnode,
                    parentComponent,
                    parentSuspense,
                    slotScopeIds,
                    optimized
                  );
                }
              } else if (shapeFlag & 6) {
                vnode.slotScopeIds = slotScopeIds;
                const container = parentNode(node);
                if (isFragmentStart) {
                  nextNode = locateClosingAnchor(node);
                } else if (isComment(node) && node.data === "teleport start") {
                  nextNode = locateClosingAnchor(node, node.data, "teleport end");
                } else {
                  nextNode = nextSibling(node);
                }
                mountComponent(
                  vnode,
                  container,
                  null,
                  parentComponent,
                  parentSuspense,
                  getContainerType(container),
                  optimized
                );
                if (isAsyncWrapper(vnode) && !vnode.component.subTree) {
                  let subTree;
                  if (isFragmentStart) {
                    subTree = createVNode(Static);
                    subTree.anchor = nextNode ? nextNode.previousSibling : container.lastChild;
                  } else {
                    subTree = node.nodeType === 3 ? createTextVNode("") : createVNode("div");
                  }
                  subTree.el = node;
                  vnode.component.subTree = subTree;
                }
              } else if (shapeFlag & 64) {
                if (domType !== 8) {
                  nextNode = onMismatch();
                } else {
                  nextNode = vnode.type.hydrate(
                    node,
                    vnode,
                    parentComponent,
                    parentSuspense,
                    slotScopeIds,
                    optimized,
                    rendererInternals,
                    hydrateChildren
                  );
                }
              } else if (shapeFlag & 128) {
                nextNode = vnode.type.hydrate(
                  node,
                  vnode,
                  parentComponent,
                  parentSuspense,
                  getContainerType(parentNode(node)),
                  slotScopeIds,
                  optimized,
                  rendererInternals,
                  hydrateNode
                );
              } else {
                warn$1("Invalid HostVNode type:", type, `(${typeof type})`);
              }
          }
          if (ref != null) {
            setRef(ref, null, parentSuspense, vnode);
          }
          return nextNode;
        };
        const hydrateElement = (el, vnode, parentComponent, parentSuspense, slotScopeIds, optimized) => {
          optimized = optimized || !!vnode.dynamicChildren;
          const {
            type,
            dynamicProps,
            props,
            patchFlag,
            shapeFlag,
            dirs,
            transition
          } = vnode;
          const forcePatch = type === "input" || type === "option";
          {
            if (dirs) {
              invokeDirectiveHook(vnode, null, parentComponent, "created");
            }
            let needCallTransitionHooks = false;
            if (isTemplateNode(el)) {
              needCallTransitionHooks = needTransition(
                null,
                // no need check parentSuspense in hydration
                transition
              ) && parentComponent && parentComponent.vnode.props && parentComponent.vnode.props.appear;
              const content = el.content.firstChild;
              if (needCallTransitionHooks) {
                const cls = content.getAttribute("class");
                if (cls) content.$cls = cls;
                transition.beforeEnter(content);
              }
              replaceNode(content, el, parentComponent);
              vnode.el = el = content;
            }
            if (shapeFlag & 16 && // skip if element has innerHTML / textContent
            !(props && (props.innerHTML || props.textContent))) {
              let next = hydrateChildren(
                el.firstChild,
                vnode,
                el,
                parentComponent,
                parentSuspense,
                slotScopeIds,
                optimized
              );
              if (next && !isMismatchAllowed(
                el,
                1
                /* CHILDREN */
              )) {
                warn$1(
                  `Hydration children mismatch on`,
                  el,
                  `
Server rendered element contains more child nodes than client vdom.`
                );
                logMismatchError();
              }
              while (next) {
                const cur = next;
                next = next.nextSibling;
                remove2(cur);
              }
            } else if (shapeFlag & 8) {
              let clientText = vnode.children;
              if (clientText[0] === "\n" && (el.tagName === "PRE" || el.tagName === "TEXTAREA")) {
                clientText = clientText.slice(1);
              }
              const { textContent } = el;
              if (textContent !== clientText && // innerHTML normalize \r\n or \r into a single \n in the DOM
              textContent !== clientText.replace(/\r\n|\r/g, "\n")) {
                if (!isMismatchAllowed(
                  el,
                  0
                  /* TEXT */
                )) {
                  warn$1(
                    `Hydration text content mismatch on`,
                    el,
                    `
  - rendered on server: ${textContent}
  - expected on client: ${clientText}`
                  );
                  logMismatchError();
                }
                el.textContent = vnode.children;
              }
            }
            if (props) {
              {
                const isCustomElement = el.tagName.includes("-");
                const namespace = el.namespaceURI.includes("svg") ? "svg" : el.namespaceURI.includes("MathML") ? "mathml" : void 0;
                for (const key in props) {
                  if (
                    // #11189 skip if this node has directives that have created hooks
                    // as it could have mutated the DOM in any possible way
                    !(dirs && dirs.some((d) => d.dir.created)) && propHasMismatch(el, key, props[key], vnode, parentComponent)
                  ) {
                    logMismatchError();
                  }
                  if (forcePatch && (key.endsWith("value") || key === "indeterminate") || shared.isOn(key) && !shared.isReservedProp(key) || // force hydrate v-bind with .prop modifiers
                  key[0] === "." || isCustomElement && !shared.isReservedProp(key) || dynamicProps && dynamicProps.includes(key)) {
                    if (isUnchangedResourceProp(el, key, props[key])) {
                      continue;
                    }
                    patchProp2(el, key, null, props[key], namespace, parentComponent);
                  }
                }
              }
            }
            let vnodeHooks;
            if (vnodeHooks = props && props.onVnodeBeforeMount) {
              invokeVNodeHook(vnodeHooks, parentComponent, vnode);
            }
            if (dirs) {
              invokeDirectiveHook(vnode, null, parentComponent, "beforeMount");
            }
            if ((vnodeHooks = props && props.onVnodeMounted) || dirs || needCallTransitionHooks) {
              queueEffectWithSuspense(() => {
                vnodeHooks && invokeVNodeHook(vnodeHooks, parentComponent, vnode);
                needCallTransitionHooks && transition.enter(el);
                dirs && invokeDirectiveHook(vnode, null, parentComponent, "mounted");
              }, parentSuspense);
            }
          }
          return el.nextSibling;
        };
        const hydrateChildren = (node, parentVNode, container, parentComponent, parentSuspense, slotScopeIds, optimized) => {
          optimized = optimized || !!parentVNode.dynamicChildren;
          const children = parentVNode.children;
          const l = children.length;
          let hasCheckedMismatch = false;
          for (let i = 0; i < l; i++) {
            const vnode = optimized ? children[i] : children[i] = normalizeVNode(children[i]);
            const isText = vnode.type === Text;
            if (node) {
              if (isText && !optimized) {
                if (i + 1 < l && normalizeVNode(children[i + 1]).type === Text) {
                  insert2(
                    createText(
                      node.data.slice(vnode.children.length)
                    ),
                    container,
                    nextSibling(node)
                  );
                  node.data = vnode.children;
                }
              }
              node = hydrateNode(
                node,
                vnode,
                parentComponent,
                parentSuspense,
                slotScopeIds,
                optimized
              );
            } else if (isText && !vnode.children) {
              insert2(vnode.el = createText(""), container);
            } else {
              if (!hasCheckedMismatch) {
                hasCheckedMismatch = true;
                if (!isMismatchAllowed(
                  container,
                  1
                  /* CHILDREN */
                )) {
                  warn$1(
                    `Hydration children mismatch on`,
                    container,
                    `
Server rendered element contains fewer child nodes than client vdom.`
                  );
                  logMismatchError();
                }
              }
              patch(
                null,
                vnode,
                container,
                null,
                parentComponent,
                parentSuspense,
                getContainerType(container),
                slotScopeIds
              );
            }
          }
          return node;
        };
        const hydrateFragment = (node, vnode, parentComponent, parentSuspense, slotScopeIds, optimized) => {
          const { slotScopeIds: fragmentSlotScopeIds } = vnode;
          if (fragmentSlotScopeIds) {
            slotScopeIds = slotScopeIds ? slotScopeIds.concat(fragmentSlotScopeIds) : fragmentSlotScopeIds;
          }
          const container = parentNode(node);
          const next = hydrateChildren(
            nextSibling(node),
            vnode,
            container,
            parentComponent,
            parentSuspense,
            slotScopeIds,
            optimized
          );
          if (next && isComment(next) && next.data === "]") {
            return nextSibling(vnode.anchor = next);
          } else {
            logMismatchError();
            insert2(vnode.anchor = createComment(`]`), container, next);
            return next;
          }
        };
        const handleMismatch = (node, vnode, parentComponent, parentSuspense, slotScopeIds, isFragment) => {
          if (!isNodeMismatchAllowed(node, vnode)) {
            warn$1(
              `Hydration node mismatch:
- rendered on server:`,
              node,
              node.nodeType === 3 ? `(text)` : isComment(node) && node.data === "[" ? `(start of fragment)` : ``,
              `
- expected on client:`,
              vnode.type
            );
            logMismatchError();
          }
          vnode.el = null;
          if (isFragment) {
            const end = locateClosingAnchor(node);
            while (true) {
              const next2 = nextSibling(node);
              if (next2 && next2 !== end) {
                remove2(next2);
              } else {
                break;
              }
            }
          }
          const next = nextSibling(node);
          const container = parentNode(node);
          remove2(node);
          patch(
            null,
            vnode,
            container,
            next,
            parentComponent,
            parentSuspense,
            getContainerType(container),
            slotScopeIds
          );
          if (parentComponent) {
            parentComponent.vnode.el = vnode.el;
            updateHOCHostEl(parentComponent, vnode.el);
          }
          return next;
        };
        const locateClosingAnchor = (node, open = "[", close = "]") => {
          let match = 0;
          while (node) {
            node = nextSibling(node);
            if (node && isComment(node)) {
              if (node.data === open) match++;
              if (node.data === close) {
                if (match === 0) {
                  return nextSibling(node);
                } else {
                  match--;
                }
              }
            }
          }
          return node;
        };
        const replaceNode = (newNode, oldNode, parentComponent) => {
          const parentNode2 = oldNode.parentNode;
          if (parentNode2) {
            parentNode2.replaceChild(newNode, oldNode);
          }
          let parent = parentComponent;
          while (parent) {
            if (parent.vnode.el === oldNode) {
              parent.vnode.el = parent.subTree.el = newNode;
            }
            parent = parent.parent;
          }
        };
        const isTemplateNode = (node) => {
          return node.nodeType === 1 && node.tagName === "TEMPLATE";
        };
        return [hydrate, hydrateNode];
      }
      var resourceProps = /* @__PURE__ */ new Set(["src", "srcset", "href", "poster"]);
      function isUnchangedResourceProp(el, key, clientValue) {
        if (!resourceProps.has(key)) {
          return false;
        }
        return el.getAttribute(key) === (clientValue == null ? null : `${clientValue}`);
      }
      function propHasMismatch(el, key, clientValue, vnode, instance) {
        let mismatchType;
        let mismatchKey;
        let actual;
        let expected;
        if (key === "class") {
          if (el.$cls) {
            actual = el.$cls;
            delete el.$cls;
          } else {
            actual = el.getAttribute("class");
          }
          expected = shared.normalizeClass(clientValue);
          if (!isSetEqual(toClassSet(actual || ""), toClassSet(expected))) {
            mismatchType = 2;
            mismatchKey = `class`;
          }
        } else if (key === "style") {
          actual = el.getAttribute("style") || "";
          expected = shared.isString(clientValue) ? clientValue : shared.stringifyStyle(shared.normalizeStyle(clientValue));
          const actualMap = toStyleMap(actual);
          const expectedMap = toStyleMap(expected);
          if (vnode.dirs) {
            for (const { dir, value } of vnode.dirs) {
              if (dir.name === "show" && !value) {
                expectedMap.set("display", "none");
              }
            }
          }
          if (instance) {
            resolveCssVars(instance, vnode, expectedMap);
          }
          if (!isMapEqual(actualMap, expectedMap)) {
            mismatchType = 3;
            mismatchKey = "style";
          }
        } else if (el instanceof SVGElement && shared.isKnownSvgAttr(key) || el instanceof HTMLElement && (shared.isBooleanAttr(key) || shared.isKnownHtmlAttr(key))) {
          if (key === "hidden") {
            actual = normalizeHiddenValue(el.getAttribute(key));
            expected = normalizeHiddenValue(clientValue);
          } else if (shared.isBooleanAttr(key)) {
            actual = el.hasAttribute(key);
            expected = shared.includeBooleanAttr(clientValue);
          } else if (clientValue == null) {
            actual = el.hasAttribute(key);
            expected = false;
          } else {
            if (el.hasAttribute(key)) {
              actual = el.getAttribute(key);
            } else if (key === "value" && el.tagName === "TEXTAREA") {
              actual = el.value;
            } else {
              actual = false;
            }
            expected = shared.isRenderableAttrValue(clientValue) ? String(clientValue) : false;
          }
          if (actual !== expected) {
            mismatchType = 4;
            mismatchKey = key;
          }
        }
        if (mismatchType != null && !isMismatchAllowed(el, mismatchType)) {
          const format = (v) => v === false ? `(not rendered)` : `${mismatchKey}="${v}"`;
          const preSegment = `Hydration ${MismatchTypeString[mismatchType]} mismatch on`;
          const postSegment = `
  - rendered on server: ${format(actual)}
  - expected on client: ${format(expected)}
  Note: this mismatch is check-only. The DOM will not be rectified in production due to performance overhead.
  You should fix the source of the mismatch.`;
          {
            warn$1(preSegment, el, postSegment);
          }
          return true;
        }
        return false;
      }
      function normalizeHiddenValue(value) {
        if (!shared.isRenderableAttrValue(value)) {
          return false;
        }
        if (shared.isString(value)) {
          return value.toLowerCase() === "until-found" ? "until-found" : "";
        }
        return shared.includeBooleanAttr(value) ? "" : false;
      }
      function toClassSet(str) {
        return new Set(str.trim().split(/\s+/));
      }
      function isSetEqual(a, b) {
        if (a.size !== b.size) {
          return false;
        }
        for (const s of a) {
          if (!b.has(s)) {
            return false;
          }
        }
        return true;
      }
      function toStyleMap(str) {
        const styleMap = /* @__PURE__ */ new Map();
        for (const item of str.split(";")) {
          let [key, value] = item.split(":");
          key = key.trim();
          value = value && value.trim();
          if (key && value) {
            styleMap.set(key, value);
          }
        }
        return styleMap;
      }
      function isMapEqual(a, b) {
        if (a.size !== b.size) {
          return false;
        }
        for (const [key, value] of a) {
          if (value !== b.get(key)) {
            return false;
          }
        }
        return true;
      }
      function resolveCssVars(instance, vnode, expectedMap) {
        const root = instance.subTree;
        if (instance.getCssVars && (vnode === root || root && root.type === Fragment && root.children.includes(vnode))) {
          const cssVars = instance.getCssVars();
          for (const key in cssVars) {
            const value = shared.normalizeCssVarValue(cssVars[key]);
            expectedMap.set(`--${shared.getEscapedCssVarName(key, false)}`, value);
          }
        }
        if (vnode === root && instance.parent) {
          resolveCssVars(instance.parent, instance.vnode, expectedMap);
        }
      }
      var allowMismatchAttr = "data-allow-mismatch";
      var MismatchTypeString = {
        [
          0
          /* TEXT */
        ]: "text",
        [
          1
          /* CHILDREN */
        ]: "children",
        [
          2
          /* CLASS */
        ]: "class",
        [
          3
          /* STYLE */
        ]: "style",
        [
          4
          /* ATTRIBUTE */
        ]: "attribute"
      };
      function isMismatchAllowed(el, allowedType) {
        if (allowedType === 0 || allowedType === 1) {
          while (el && !el.hasAttribute(allowMismatchAttr)) {
            el = el.parentElement;
          }
        }
        return isMismatchAllowedByAttr(
          el && el.getAttribute(allowMismatchAttr),
          allowedType
        );
      }
      function isMismatchAllowedByAttr(allowedAttr, allowedType) {
        if (allowedAttr == null) {
          return false;
        } else if (allowedAttr === "") {
          return true;
        } else {
          const list = allowedAttr.split(",");
          if (allowedType === 0 && list.includes("children")) {
            return true;
          }
          return list.includes(MismatchTypeString[allowedType]);
        }
      }
      function isNodeMismatchAllowed(node, vnode) {
        return isMismatchAllowed(
          node.parentElement,
          1
          /* CHILDREN */
        ) || isMismatchAllowedByNode(node) || isMismatchAllowedByVNode(vnode);
      }
      function isMismatchAllowedByNode(node) {
        return node.nodeType === 1 && isMismatchAllowedByAttr(
          node.getAttribute(allowMismatchAttr),
          1
          /* CHILDREN */
        );
      }
      function isMismatchAllowedByVNode({ props }) {
        const allowedAttr = props && props[allowMismatchAttr];
        return typeof allowedAttr === "string" && isMismatchAllowedByAttr(
          allowedAttr,
          1
          /* CHILDREN */
        );
      }
      var requestIdleCallback = shared.getGlobalThis().requestIdleCallback || ((cb) => setTimeout(cb, 1));
      var cancelIdleCallback = shared.getGlobalThis().cancelIdleCallback || ((id) => clearTimeout(id));
      var hydrateOnIdle = (timeout = 1e4) => (hydrate) => {
        const id = requestIdleCallback(hydrate, { timeout });
        return () => cancelIdleCallback(id);
      };
      function elementIsVisibleInViewport(el) {
        const { top, left, bottom, right } = el.getBoundingClientRect();
        const { innerHeight, innerWidth } = window;
        return (top > 0 && top < innerHeight || bottom > 0 && bottom < innerHeight) && (left > 0 && left < innerWidth || right > 0 && right < innerWidth);
      }
      var hydrateOnVisible = (opts) => (hydrate, forEach) => {
        const ob = new IntersectionObserver((entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            ob.disconnect();
            hydrate();
            break;
          }
        }, opts);
        forEach((el) => {
          if (!(el instanceof Element)) return;
          if (elementIsVisibleInViewport(el)) {
            hydrate();
            ob.disconnect();
            return false;
          }
          ob.observe(el);
        });
        return () => ob.disconnect();
      };
      var hydrateOnMediaQuery = (query) => (hydrate) => {
        if (query) {
          const mql = matchMedia(query);
          if (mql.matches) {
            hydrate();
          } else {
            mql.addEventListener("change", hydrate, { once: true });
            return () => mql.removeEventListener("change", hydrate);
          }
        }
      };
      var hydrateOnInteraction = (interactions = []) => (hydrate, forEach) => {
        if (shared.isString(interactions)) interactions = [interactions];
        let hasHydrated = false;
        const doHydrate = (e) => {
          if (!hasHydrated) {
            hasHydrated = true;
            teardown();
            hydrate();
            e.target.dispatchEvent(new e.constructor(e.type, e));
          }
        };
        const teardown = () => {
          forEach((el) => {
            for (const i of interactions) {
              el.removeEventListener(i, doHydrate);
            }
          });
        };
        forEach((el) => {
          for (const i of interactions) {
            el.addEventListener(i, doHydrate, { once: true });
          }
        });
        return teardown;
      };
      function forEachElement(node, cb) {
        if (isComment(node) && node.data === "[") {
          let depth = 1;
          let next = node.nextSibling;
          while (next) {
            if (next.nodeType === 1) {
              const result = cb(next);
              if (result === false) {
                break;
              }
            } else if (isComment(next)) {
              if (next.data === "]") {
                if (--depth === 0) break;
              } else if (next.data === "[") {
                depth++;
              }
            }
            next = next.nextSibling;
          }
        } else {
          cb(node);
        }
      }
      var isAsyncWrapper = (i) => !!i.type.__asyncLoader;
      // @__NO_SIDE_EFFECTS__
      function defineAsyncComponent(source) {
        if (shared.isFunction(source)) {
          source = { loader: source };
        }
        const {
          loader: loader2,
          loadingComponent,
          errorComponent,
          delay = 200,
          hydrate: hydrateStrategy,
          timeout,
          // undefined = never times out
          suspensible = true,
          onError: userOnError
        } = source;
        let pendingRequest = null;
        let resolvedComp;
        let retries = 0;
        const retry = () => {
          retries++;
          pendingRequest = null;
          return load();
        };
        const load = () => {
          let thisRequest;
          return pendingRequest || (thisRequest = pendingRequest = loader2().catch((err) => {
            err = err instanceof Error ? err : new Error(String(err));
            if (userOnError) {
              return new Promise((resolve2, reject) => {
                const userRetry = () => resolve2(retry());
                const userFail = () => reject(err);
                userOnError(err, userRetry, userFail, retries + 1);
              });
            } else {
              throw err;
            }
          }).then((comp) => {
            if (thisRequest !== pendingRequest && pendingRequest) {
              return pendingRequest;
            }
            if (!comp) {
              warn$1(
                `Async component loader resolved to undefined. If you are using retry(), make sure to return its return value.`
              );
            }
            if (comp && (comp.__esModule || comp[Symbol.toStringTag] === "Module")) {
              comp = comp.default;
            }
            if (comp && !shared.isObject(comp) && !shared.isFunction(comp)) {
              throw new Error(`Invalid async component load result: ${comp}`);
            }
            resolvedComp = comp;
            return comp;
          }));
        };
        return /* @__PURE__ */ defineComponent2({
          name: "AsyncComponentWrapper",
          __asyncLoader: load,
          __asyncHydrate(el, instance, hydrate) {
            const wasConnected = el.isConnected;
            let patched = false;
            (instance.bu || (instance.bu = [])).push(() => patched = true);
            const performHydrate = () => {
              if (patched) {
                {
                  warn$1(
                    `Skipping lazy hydration for component '${getComponentName(resolvedComp) || resolvedComp.__file}': it was updated before lazy hydration performed.`
                  );
                }
                return;
              }
              if (!el.parentNode || wasConnected && !el.isConnected) return;
              hydrate();
            };
            const doHydrate = hydrateStrategy ? () => {
              const teardown = hydrateStrategy(
                performHydrate,
                (cb) => forEachElement(el, cb)
              );
              if (teardown) {
                (instance.bum || (instance.bum = [])).push(teardown);
              }
            } : performHydrate;
            if (resolvedComp) {
              doHydrate();
            } else {
              load().then(() => !instance.isUnmounted && doHydrate());
            }
          },
          get __asyncResolved() {
            return resolvedComp;
          },
          setup() {
            const instance = currentInstance;
            markAsyncBoundary(instance);
            if (resolvedComp) {
              return () => createInnerComp(resolvedComp, instance);
            }
            const onError = (err) => {
              pendingRequest = null;
              handleError(
                err,
                instance,
                13,
                !errorComponent
              );
            };
            if (suspensible && instance.suspense || isInSSRComponentSetup) {
              return load().then((comp) => {
                return () => createInnerComp(comp, instance);
              }).catch((err) => {
                onError(err);
                return () => errorComponent ? createVNode(errorComponent, {
                  error: err
                }) : null;
              });
            }
            const loaded = reactivity.ref(false);
            const error = reactivity.ref();
            const delayed = reactivity.ref(!!delay);
            let timeoutTimer;
            let delayTimer;
            onUnmounted(() => {
              if (timeoutTimer != null) clearTimeout(timeoutTimer);
              if (delayTimer != null) clearTimeout(delayTimer);
            });
            if (delay) {
              delayTimer = setTimeout(() => {
                if (instance.isUnmounted) return;
                delayed.value = false;
              }, delay);
            }
            if (timeout != null) {
              timeoutTimer = setTimeout(() => {
                if (instance.isUnmounted) return;
                if (!loaded.value && !error.value) {
                  const err = new Error(
                    `Async component timed out after ${timeout}ms.`
                  );
                  onError(err);
                  error.value = err;
                }
              }, timeout);
            }
            load().then(() => {
              if (instance.isUnmounted) return;
              loaded.value = true;
              if (instance.parent && isKeepAlive(instance.parent.vnode)) {
                instance.parent.update();
              }
            }).catch((err) => {
              if (instance.isUnmounted) {
                pendingRequest = null;
                return;
              }
              onError(err);
              error.value = err;
            });
            return () => {
              if (loaded.value && resolvedComp) {
                return createInnerComp(resolvedComp, instance);
              } else if (error.value && errorComponent) {
                return createVNode(errorComponent, {
                  error: error.value
                });
              } else if (loadingComponent && !delayed.value) {
                return createInnerComp(
                  loadingComponent,
                  instance
                );
              }
            };
          }
        });
      }
      function createInnerComp(comp, parent) {
        const { ref: ref2, props, children, ce } = parent.vnode;
        const vnode = createVNode(comp, props, children);
        vnode.ref = ref2;
        vnode.ce = ce;
        delete parent.vnode.ce;
        return vnode;
      }
      var isKeepAlive = (vnode) => vnode.type.__isKeepAlive;
      var KeepAliveImpl = {
        name: `KeepAlive`,
        // Marker for special handling inside the renderer. We are not using a ===
        // check directly on KeepAlive in the renderer, because importing it directly
        // would prevent it from being tree-shaken.
        __isKeepAlive: true,
        props: {
          include: [String, RegExp, Array],
          exclude: [String, RegExp, Array],
          max: [String, Number]
        },
        setup(props, { slots }) {
          const instance = getCurrentInstance();
          const sharedContext = instance.ctx;
          if (!sharedContext.renderer) {
            return () => {
              const children = slots.default && slots.default();
              return children && children.length === 1 ? children[0] : children;
            };
          }
          const cache2 = /* @__PURE__ */ new Map();
          const keys = /* @__PURE__ */ new Set();
          let current = null;
          {
            instance.__v_cache = cache2;
          }
          const parentSuspense = instance.suspense;
          const {
            renderer: {
              p: patch,
              m: move,
              um: _unmount,
              o: { createElement }
            }
          } = sharedContext;
          const storageContainer = createElement("div");
          sharedContext.activate = (vnode, container, anchor, namespace, optimized) => {
            const instance2 = vnode.component;
            move(vnode, container, anchor, 0, parentSuspense);
            patch(
              instance2.vnode,
              vnode,
              container,
              anchor,
              instance2,
              parentSuspense,
              namespace,
              vnode.slotScopeIds,
              optimized
            );
            queuePostRenderEffect(() => {
              instance2.isDeactivated = false;
              if (instance2.a) {
                shared.invokeArrayFns(instance2.a);
              }
              const vnodeHook = vnode.props && vnode.props.onVnodeMounted;
              if (vnodeHook) {
                invokeVNodeHook(vnodeHook, instance2.parent, vnode);
              }
            }, parentSuspense);
            {
              devtoolsComponentAdded(instance2);
            }
          };
          sharedContext.deactivate = (vnode) => {
            const instance2 = vnode.component;
            invalidateMount(instance2.m);
            invalidateMount(instance2.a);
            move(vnode, storageContainer, null, 1, parentSuspense);
            queuePostRenderEffect(() => {
              if (instance2.da) {
                shared.invokeArrayFns(instance2.da);
              }
              const vnodeHook = vnode.props && vnode.props.onVnodeUnmounted;
              if (vnodeHook) {
                invokeVNodeHook(vnodeHook, instance2.parent, vnode);
              }
              instance2.isDeactivated = true;
            }, parentSuspense);
            {
              devtoolsComponentAdded(instance2);
            }
          };
          function unmount(vnode) {
            resetShapeFlag(vnode);
            _unmount(vnode, instance, parentSuspense, true);
          }
          function pruneCache(filter) {
            cache2.forEach((vnode, key) => {
              const name = getComponentName(
                isAsyncWrapper(vnode) ? vnode.type.__asyncResolved || {} : vnode.type
              );
              if (name && !filter(name)) {
                pruneCacheEntry(key);
              }
            });
          }
          function pruneCacheEntry(key) {
            const cached = cache2.get(key);
            if (cached && (!current || !isSameVNodeType(cached, current))) {
              unmount(cached);
            } else if (current) {
              resetShapeFlag(current);
            }
            cache2.delete(key);
            keys.delete(key);
          }
          watch(
            () => [props.include, props.exclude],
            ([include, exclude]) => {
              include && pruneCache((name) => matches(include, name));
              exclude && pruneCache((name) => !matches(exclude, name));
            },
            // prune post-render after `current` has been updated
            { flush: "post", deep: true }
          );
          let pendingCacheKey = null;
          const cacheSubtree = () => {
            if (pendingCacheKey != null) {
              if (isSuspense(instance.subTree.type)) {
                queuePostRenderEffect(() => {
                  const vnode = getInnerChild(instance.subTree);
                  if (vnode.component) {
                    cache2.set(pendingCacheKey, vnode);
                  }
                }, instance.subTree.suspense);
              } else {
                cache2.set(pendingCacheKey, getInnerChild(instance.subTree));
              }
            }
          };
          onMounted(cacheSubtree);
          onUpdated(cacheSubtree);
          onBeforeUnmount(() => {
            cache2.forEach((cached) => {
              const { subTree, suspense } = instance;
              const vnode = getInnerChild(subTree);
              if (cached.type === vnode.type && cached.key === vnode.key) {
                resetShapeFlag(vnode);
                const da = vnode.component.da;
                da && queuePostRenderEffect(da, suspense);
                return;
              }
              unmount(cached);
            });
          });
          return () => {
            pendingCacheKey = null;
            if (!slots.default) {
              return current = null;
            }
            const children = slots.default();
            const rawVNode = children[0];
            if (children.length > 1) {
              {
                warn$1(`KeepAlive should contain exactly one component child.`);
              }
              current = null;
              return children;
            } else if (!isVNode(rawVNode) || !(rawVNode.shapeFlag & 4) && !(rawVNode.shapeFlag & 128)) {
              current = null;
              return rawVNode;
            }
            let vnode = getInnerChild(rawVNode);
            if (vnode.type === Comment) {
              current = null;
              return vnode;
            }
            const comp = vnode.type;
            const name = getComponentName(
              isAsyncWrapper(vnode) ? vnode.type.__asyncResolved || {} : comp
            );
            const { include, exclude, max } = props;
            if (include && (!name || !matches(include, name)) || exclude && name && matches(exclude, name)) {
              vnode.shapeFlag &= -257;
              current = vnode;
              return rawVNode;
            }
            const key = vnode.key == null ? comp : vnode.key;
            const cachedVNode = cache2.get(key);
            if (vnode.el) {
              vnode = cloneVNode(vnode);
              if (rawVNode.shapeFlag & 128) {
                rawVNode.ssContent = vnode;
              }
            }
            pendingCacheKey = key;
            if (cachedVNode) {
              vnode.el = cachedVNode.el;
              vnode.component = cachedVNode.component;
              if (vnode.transition) {
                setTransitionHooks(vnode, vnode.transition);
              }
              vnode.shapeFlag |= 512;
              keys.delete(key);
              keys.add(key);
            } else {
              keys.add(key);
              if (max && keys.size > parseInt(max, 10)) {
                pruneCacheEntry(keys.values().next().value);
              }
            }
            vnode.shapeFlag |= 256;
            current = vnode;
            return isSuspense(rawVNode.type) ? rawVNode : vnode;
          };
        }
      };
      var KeepAlive = KeepAliveImpl;
      function matches(pattern, name) {
        if (shared.isArray(pattern)) {
          return pattern.some((p) => matches(p, name));
        } else if (shared.isString(pattern)) {
          return pattern.split(",").includes(name);
        } else if (shared.isRegExp(pattern)) {
          pattern.lastIndex = 0;
          return pattern.test(name);
        }
        return false;
      }
      function onActivated(hook, target) {
        registerKeepAliveHook(hook, "a", target);
      }
      function onDeactivated(hook, target) {
        registerKeepAliveHook(hook, "da", target);
      }
      function registerKeepAliveHook(hook, type, target = currentInstance) {
        const wrappedHook = hook.__wdc || (hook.__wdc = () => {
          let current = target;
          while (current) {
            if (current.isDeactivated) {
              return;
            }
            current = current.parent;
          }
          return hook();
        });
        injectHook(type, wrappedHook, target);
        if (target) {
          let current = target.parent;
          while (current && current.parent) {
            if (isKeepAlive(current.parent.vnode)) {
              injectToKeepAliveRoot(wrappedHook, type, target, current);
            }
            current = current.parent;
          }
        }
      }
      function injectToKeepAliveRoot(hook, type, target, keepAliveRoot) {
        const injected = injectHook(
          type,
          hook,
          keepAliveRoot,
          true
          /* prepend */
        );
        onUnmounted(() => {
          shared.remove(keepAliveRoot[type], injected);
        }, target);
      }
      function resetShapeFlag(vnode) {
        vnode.shapeFlag &= -257;
        vnode.shapeFlag &= -513;
      }
      function getInnerChild(vnode) {
        return vnode.shapeFlag & 128 ? vnode.ssContent : vnode;
      }
      function injectHook(type, hook, target = currentInstance, prepend = false) {
        if (target) {
          const hooks = target[type] || (target[type] = []);
          const wrappedHook = hook.__weh || (hook.__weh = (...args) => {
            reactivity.pauseTracking();
            const reset = setCurrentInstance(target);
            const res = callWithAsyncErrorHandling(hook, target, type, args);
            reset();
            reactivity.resetTracking();
            return res;
          });
          if (prepend) {
            hooks.unshift(wrappedHook);
          } else {
            hooks.push(wrappedHook);
          }
          return wrappedHook;
        } else {
          const apiName = shared.toHandlerKey(ErrorTypeStrings$1[type].replace(/ hook$/, ""));
          warn$1(
            `${apiName} is called when there is no active component instance to be associated with. Lifecycle injection APIs can only be used during execution of setup(). If you are using async setup(), make sure to register lifecycle hooks before the first await statement.`
          );
        }
      }
      var createHook = (lifecycle) => (hook, target = currentInstance) => {
        if (!isInSSRComponentSetup || lifecycle === "sp") {
          injectHook(lifecycle, (...args) => hook(...args), target);
        }
      };
      var onBeforeMount = createHook("bm");
      var onMounted = createHook("m");
      var onBeforeUpdate = createHook(
        "bu"
      );
      var onUpdated = createHook("u");
      var onBeforeUnmount = createHook(
        "bum"
      );
      var onUnmounted = createHook("um");
      var onServerPrefetch = createHook(
        "sp"
      );
      var onRenderTriggered = createHook("rtg");
      var onRenderTracked = createHook("rtc");
      function onErrorCaptured(hook, target = currentInstance) {
        injectHook("ec", hook, target);
      }
      var COMPONENTS = "components";
      var DIRECTIVES = "directives";
      function resolveComponent(name, maybeSelfReference) {
        return resolveAsset(COMPONENTS, name, true, maybeSelfReference) || name;
      }
      var NULL_DYNAMIC_COMPONENT = /* @__PURE__ */ Symbol.for("v-ndc");
      function resolveDynamicComponent(component) {
        if (shared.isString(component)) {
          return resolveAsset(COMPONENTS, component, false) || component;
        } else {
          return component || NULL_DYNAMIC_COMPONENT;
        }
      }
      function resolveDirective(name) {
        return resolveAsset(DIRECTIVES, name);
      }
      function resolveAsset(type, name, warnMissing = true, maybeSelfReference = false) {
        const instance = currentRenderingInstance || currentInstance;
        if (instance) {
          const Component = instance.type;
          if (type === COMPONENTS) {
            const selfName = getComponentName(
              Component,
              false
            );
            if (selfName && (selfName === name || selfName === shared.camelize(name) || selfName === shared.capitalize(shared.camelize(name)))) {
              return Component;
            }
          }
          const res = (
            // local registration
            // check instance[type] first which is resolved for options API
            resolve(instance[type] || Component[type], name) || // global registration
            resolve(instance.appContext[type], name)
          );
          if (!res && maybeSelfReference) {
            return Component;
          }
          if (warnMissing && !res) {
            const extra = type === COMPONENTS ? `
If this is a native custom element, make sure to exclude it from component resolution via compilerOptions.isCustomElement.` : ``;
            warn$1(`Failed to resolve ${type.slice(0, -1)}: ${name}${extra}`);
          }
          return res;
        } else {
          warn$1(
            `resolve${shared.capitalize(type.slice(0, -1))} can only be used in render() or setup().`
          );
        }
      }
      function resolve(registry, name) {
        return registry && (registry[name] || registry[shared.camelize(name)] || registry[shared.capitalize(shared.camelize(name))]);
      }
      function renderList(source, renderItem, cache2, index) {
        let ret;
        const cached = cache2 && cache2[index];
        const sourceIsArray = shared.isArray(source);
        if (sourceIsArray || shared.isString(source)) {
          const sourceIsReactiveArray = sourceIsArray && reactivity.isReactive(source);
          let needsWrap = false;
          let isReadonlySource = false;
          if (sourceIsReactiveArray) {
            needsWrap = !reactivity.isShallow(source);
            isReadonlySource = reactivity.isReadonly(source);
            source = reactivity.shallowReadArray(source);
          }
          ret = new Array(source.length);
          for (let i = 0, l = source.length; i < l; i++) {
            ret[i] = renderItem(
              needsWrap ? isReadonlySource ? reactivity.toReadonly(reactivity.toReactive(source[i])) : reactivity.toReactive(source[i]) : source[i],
              i,
              void 0,
              cached && cached[i]
            );
          }
        } else if (typeof source === "number") {
          if (!Number.isInteger(source) || source < 0) {
            warn$1(
              `The v-for range expects a positive integer value but got ${source}.`
            );
            ret = [];
          } else {
            ret = new Array(source);
            for (let i = 0; i < source; i++) {
              ret[i] = renderItem(i + 1, i, void 0, cached && cached[i]);
            }
          }
        } else if (shared.isObject(source)) {
          if (source[Symbol.iterator]) {
            ret = Array.from(
              source,
              (item, i) => renderItem(item, i, void 0, cached && cached[i])
            );
          } else {
            const keys = Object.keys(source);
            ret = new Array(keys.length);
            for (let i = 0, l = keys.length; i < l; i++) {
              const key = keys[i];
              ret[i] = renderItem(source[key], key, i, cached && cached[i]);
            }
          }
        } else {
          ret = [];
        }
        if (cache2) {
          cache2[index] = ret;
        }
        return ret;
      }
      function createSlots(slots, dynamicSlots) {
        for (let i = 0; i < dynamicSlots.length; i++) {
          const slot = dynamicSlots[i];
          if (shared.isArray(slot)) {
            for (let j = 0; j < slot.length; j++) {
              slots[slot[j].name] = slot[j].fn;
            }
          } else if (slot) {
            slots[slot.name] = slot.key ? (...args) => {
              const res = slot.fn(...args);
              if (res) res.key = slot.key;
              return res;
            } : slot.fn;
          }
        }
        return slots;
      }
      function renderSlot(slots, name, props, fallback, noSlotted, branchKey) {
        if (props == null) props = {};
        if (currentRenderingInstance.ce || currentRenderingInstance.parent && isAsyncWrapper(currentRenderingInstance.parent) && currentRenderingInstance.parent.ce) {
          const slotProps = branchKey != null && props.key == null ? shared.extend({}, props, { key: branchKey }) : props;
          const hasProps = Object.keys(slotProps).length > 0;
          if (name !== "default") slotProps.name = name;
          return openBlock(), createBlock(
            Fragment,
            null,
            [createVNode("slot", slotProps, fallback && fallback())],
            hasProps ? -2 : 64
          );
        }
        let slot = slots[name];
        if (slot && slot.length > 1) {
          warn$1(
            `SSR-optimized slot function detected in a non-SSR-optimized render function. You need to mark this component with $dynamic-slots in the parent template.`
          );
          slot = () => [];
        }
        if (slot && slot._c) {
          slot._d = false;
        }
        const prevStackSize = blockStack.length;
        openBlock();
        let rendered;
        try {
          const validSlotContent = slot && ensureValidVNode(slot(props));
          const slotKey = props.key || branchKey || // slot content array of a dynamic conditional slot may have a branch
          // key attached in the `createSlots` helper, respect that
          validSlotContent && validSlotContent.key;
          rendered = createBlock(
            Fragment,
            {
              key: (slotKey && !shared.isSymbol(slotKey) ? slotKey : `_${name}`) + // #7256 force differentiate fallback content from actual content
              (!validSlotContent && fallback ? "_fb" : "")
            },
            validSlotContent || (fallback ? fallback() : []),
            validSlotContent && slots._ === 1 ? 64 : -2
          );
        } catch (err) {
          for (let i = blockStack.length; i > prevStackSize; i--) closeBlock();
          throw err;
        } finally {
          if (slot && slot._c) {
            slot._d = true;
          }
        }
        if (!noSlotted && rendered.scopeId) {
          rendered.slotScopeIds = [rendered.scopeId + "-s"];
        }
        return rendered;
      }
      function ensureValidVNode(vnodes) {
        return vnodes.some((child) => {
          if (!isVNode(child)) return true;
          if (child.type === Comment) return false;
          if (child.type === Fragment && !ensureValidVNode(child.children))
            return false;
          return true;
        }) ? vnodes : null;
      }
      function toHandlers(obj, preserveCaseIfNecessary) {
        const ret = {};
        if (!shared.isObject(obj)) {
          warn$1(`v-on with no argument expects an object value.`);
          return ret;
        }
        for (const key in obj) {
          ret[preserveCaseIfNecessary && /[A-Z]/.test(key) ? `on:${key}` : shared.toHandlerKey(key)] = obj[key];
        }
        return ret;
      }
      var getPublicInstance = (i) => {
        if (!i) return null;
        if (isStatefulComponent(i)) return getComponentPublicInstance(i);
        return getPublicInstance(i.parent);
      };
      var resolveDevRootEl = (vnode) => {
        let found = false;
        while (true) {
          if (vnode.patchFlag > 0 && vnode.patchFlag & 2048) {
            const root = filterSingleRoot(vnode.children);
            if (!root) {
              return;
            }
            vnode = root;
            found = true;
            continue;
          }
          const component = vnode.component;
          if (component && component.subTree) {
            vnode = component.subTree;
            continue;
          }
          const suspense = vnode.suspense;
          if (suspense && suspense.activeBranch) {
            vnode = suspense.activeBranch;
            continue;
          }
          return found ? vnode.el : void 0;
        }
      };
      var getDevRootFragmentEl = (i) => {
        const el = i.subTree && resolveDevRootEl(i.subTree);
        return el === void 0 ? i.vnode.el : el;
      };
      var publicPropertiesMap = (
        // Move PURE marker to new line to workaround compiler discarding it
        // due to type annotation
        /* @__PURE__ */ shared.extend(/* @__PURE__ */ Object.create(null), {
          $: (i) => i,
          $el: (i) => getDevRootFragmentEl(i),
          $data: (i) => i.data,
          $props: (i) => reactivity.shallowReadonly(i.props),
          $attrs: (i) => reactivity.shallowReadonly(i.attrs),
          $slots: (i) => reactivity.shallowReadonly(i.slots),
          $refs: (i) => reactivity.shallowReadonly(i.refs),
          $parent: (i) => getPublicInstance(i.parent),
          $root: (i) => getPublicInstance(i.root),
          $host: (i) => i.ce,
          $emit: (i) => i.emit,
          $options: (i) => resolveMergedOptions(i),
          $forceUpdate: (i) => i.f || (i.f = () => {
            queueJob(i.update);
          }),
          $nextTick: (i) => i.n || (i.n = nextTick.bind(i.proxy)),
          $watch: (i) => instanceWatch.bind(i)
        })
      );
      var isReservedPrefix = (key) => key === "_" || key === "$";
      var hasSetupBinding = (state, key) => state !== shared.EMPTY_OBJ && !state.__isScriptSetup && shared.hasOwn(state, key);
      var PublicInstanceProxyHandlers = {
        get({ _: instance }, key) {
          if (key === "__v_skip") {
            return true;
          }
          const { ctx, setupState, data, props, accessCache, type, appContext } = instance;
          if (key === "__isVue") {
            return true;
          }
          if (key[0] !== "$") {
            const n = accessCache[key];
            if (n !== void 0) {
              switch (n) {
                case 1:
                  return setupState[key];
                case 2:
                  return data[key];
                case 4:
                  return ctx[key];
                case 3:
                  return props[key];
              }
            } else if (hasSetupBinding(setupState, key)) {
              accessCache[key] = 1;
              return setupState[key];
            } else if (data !== shared.EMPTY_OBJ && shared.hasOwn(data, key)) {
              accessCache[key] = 2;
              return data[key];
            } else if (shared.hasOwn(props, key)) {
              accessCache[key] = 3;
              return props[key];
            } else if (ctx !== shared.EMPTY_OBJ && shared.hasOwn(ctx, key)) {
              accessCache[key] = 4;
              return ctx[key];
            } else if (shouldCacheAccess) {
              accessCache[key] = 0;
            }
          }
          const publicGetter = publicPropertiesMap[key];
          let cssModule, globalProperties;
          if (publicGetter) {
            if (key === "$attrs") {
              reactivity.track(instance.attrs, "get", "");
              markAttrsAccessed();
            } else if (key === "$slots") {
              reactivity.track(instance, "get", key);
            }
            return publicGetter(instance);
          } else if (
            // css module (injected by vue-loader)
            (cssModule = type.__cssModules) && (cssModule = cssModule[key])
          ) {
            return cssModule;
          } else if (ctx !== shared.EMPTY_OBJ && shared.hasOwn(ctx, key)) {
            accessCache[key] = 4;
            return ctx[key];
          } else if (
            // global properties
            globalProperties = appContext.config.globalProperties, shared.hasOwn(globalProperties, key)
          ) {
            {
              return globalProperties[key];
            }
          } else if (currentRenderingInstance && (!shared.isString(key) || // #1091 avoid internal isRef/isVNode checks on component instance leading
          // to infinite warning loop
          key.indexOf("__v") !== 0)) {
            if (data !== shared.EMPTY_OBJ && isReservedPrefix(key[0]) && shared.hasOwn(data, key)) {
              warn$1(
                `Property ${JSON.stringify(
                  key
                )} must be accessed via $data because it starts with a reserved character ("$" or "_") and is not proxied on the render context.`
              );
            } else if (instance === currentRenderingInstance) {
              warn$1(
                `Property ${JSON.stringify(key)} was accessed during render but is not defined on instance.`
              );
            }
          }
        },
        set({ _: instance }, key, value) {
          const { data, setupState, ctx } = instance;
          if (hasSetupBinding(setupState, key)) {
            setupState[key] = value;
            return true;
          } else if (setupState.__isScriptSetup && shared.hasOwn(setupState, key)) {
            warn$1(`Cannot mutate <script setup> binding "${key}" from Options API.`);
            return false;
          } else if (data !== shared.EMPTY_OBJ && shared.hasOwn(data, key)) {
            data[key] = value;
            return true;
          } else if (shared.hasOwn(instance.props, key)) {
            warn$1(`Attempting to mutate prop "${key}". Props are readonly.`);
            return false;
          }
          if (key[0] === "$" && key.slice(1) in instance) {
            warn$1(
              `Attempting to mutate public property "${key}". Properties starting with $ are reserved and readonly.`
            );
            return false;
          } else {
            if (key in instance.appContext.config.globalProperties) {
              Object.defineProperty(ctx, key, {
                enumerable: true,
                configurable: true,
                value
              });
            } else {
              ctx[key] = value;
            }
          }
          return true;
        },
        has({
          _: { data, setupState, accessCache, ctx, appContext, props, type }
        }, key) {
          let cssModules;
          return !!(accessCache[key] || data !== shared.EMPTY_OBJ && key[0] !== "$" && shared.hasOwn(data, key) || hasSetupBinding(setupState, key) || shared.hasOwn(props, key) || shared.hasOwn(ctx, key) || shared.hasOwn(publicPropertiesMap, key) || shared.hasOwn(appContext.config.globalProperties, key) || (cssModules = type.__cssModules) && cssModules[key]);
        },
        defineProperty(target, key, descriptor) {
          if (descriptor.get != null) {
            target._.accessCache[key] = 0;
          } else if (shared.hasOwn(descriptor, "value")) {
            this.set(target, key, descriptor.value, null);
          }
          return Reflect.defineProperty(target, key, descriptor);
        }
      };
      {
        PublicInstanceProxyHandlers.ownKeys = (target) => {
          warn$1(
            `Avoid app logic that relies on enumerating keys on a component instance. The keys will be empty in production mode to avoid performance overhead.`
          );
          return Reflect.ownKeys(target);
        };
      }
      var RuntimeCompiledPublicInstanceProxyHandlers = /* @__PURE__ */ shared.extend({}, PublicInstanceProxyHandlers, {
        get(target, key) {
          if (key === Symbol.unscopables) {
            return;
          }
          return PublicInstanceProxyHandlers.get(target, key, target);
        },
        has(_, key) {
          const has = key[0] !== "_" && !shared.isGloballyAllowed(key);
          if (!has && PublicInstanceProxyHandlers.has(_, key)) {
            warn$1(
              `Property ${JSON.stringify(
                key
              )} should not start with _ which is a reserved prefix for Vue internals.`
            );
          }
          return has;
        }
      });
      function createDevRenderContext(instance) {
        const target = {};
        Object.defineProperty(target, `_`, {
          configurable: true,
          enumerable: false,
          get: () => instance
        });
        Object.keys(publicPropertiesMap).forEach((key) => {
          Object.defineProperty(target, key, {
            configurable: true,
            enumerable: false,
            get: () => publicPropertiesMap[key](instance),
            // intercepted by the proxy so no need for implementation,
            // but needed to prevent set errors
            set: shared.NOOP
          });
        });
        return target;
      }
      function exposePropsOnRenderContext(instance) {
        const {
          ctx,
          propsOptions: [propsOptions]
        } = instance;
        if (propsOptions) {
          Object.keys(propsOptions).forEach((key) => {
            Object.defineProperty(ctx, key, {
              enumerable: true,
              configurable: true,
              get: () => instance.props[key],
              set: shared.NOOP
            });
          });
        }
      }
      function exposeSetupStateOnRenderContext(instance) {
        const { ctx, setupState } = instance;
        Object.keys(reactivity.toRaw(setupState)).forEach((key) => {
          if (!setupState.__isScriptSetup) {
            if (isReservedPrefix(key[0])) {
              warn$1(
                `setup() return property ${JSON.stringify(
                  key
                )} should not start with "$" or "_" which are reserved prefixes for Vue internals.`
              );
              return;
            }
            Object.defineProperty(ctx, key, {
              enumerable: true,
              configurable: true,
              get: () => setupState[key],
              set: shared.NOOP
            });
          }
        });
      }
      var warnRuntimeUsage = (method) => warn$1(
        `${method}() is a compiler-hint helper that is only usable inside <script setup> of a single file component. Its arguments should be compiled away and passing it at runtime has no effect.`
      );
      function defineProps() {
        {
          warnRuntimeUsage(`defineProps`);
        }
        return null;
      }
      function defineEmits() {
        {
          warnRuntimeUsage(`defineEmits`);
        }
        return null;
      }
      function defineExpose(exposed) {
        {
          warnRuntimeUsage(`defineExpose`);
        }
      }
      function defineOptions(options) {
        {
          warnRuntimeUsage(`defineOptions`);
        }
      }
      function defineSlots() {
        {
          warnRuntimeUsage(`defineSlots`);
        }
        return null;
      }
      function defineModel() {
        {
          warnRuntimeUsage("defineModel");
        }
      }
      function withDefaults(props, defaults) {
        {
          warnRuntimeUsage(`withDefaults`);
        }
        return null;
      }
      function useSlots() {
        return getContext("useSlots").slots;
      }
      function useAttrs() {
        return getContext("useAttrs").attrs;
      }
      function getContext(calledFunctionName) {
        const i = getCurrentInstance();
        if (!i) {
          warn$1(`${calledFunctionName}() called without active instance.`);
        }
        return i.setupContext || (i.setupContext = createSetupContext(i));
      }
      function normalizePropsOrEmits(props) {
        return shared.isArray(props) ? props.reduce(
          (normalized, p) => (normalized[p] = null, normalized),
          {}
        ) : props;
      }
      function mergeDefaults(raw, defaults) {
        const props = normalizePropsOrEmits(raw);
        for (const key in defaults) {
          if (key.startsWith("__skip")) continue;
          let opt = props[key];
          if (opt) {
            if (shared.isArray(opt) || shared.isFunction(opt)) {
              opt = props[key] = { type: opt, default: defaults[key] };
            } else {
              opt.default = defaults[key];
            }
          } else if (opt === null) {
            opt = props[key] = { default: defaults[key] };
          } else {
            warn$1(`props default key "${key}" has no corresponding declaration.`);
          }
          if (opt && defaults[`__skip_${key}`]) {
            opt.skipFactory = true;
          }
        }
        return props;
      }
      function mergeModels(a, b) {
        if (!a || !b) return a || b;
        if (shared.isArray(a) && shared.isArray(b)) return a.concat(b);
        return shared.extend({}, normalizePropsOrEmits(a), normalizePropsOrEmits(b));
      }
      function createPropsRestProxy(props, excludedKeys) {
        const ret = {};
        for (const key in props) {
          if (!excludedKeys.includes(key)) {
            Object.defineProperty(ret, key, {
              enumerable: true,
              get: () => props[key]
            });
          }
        }
        return ret;
      }
      function withAsyncContext(getAwaitable) {
        const ctx = getCurrentInstance();
        const inSSRSetup = isInSSRComponentSetup;
        if (!ctx) {
          warn$1(
            `withAsyncContext called without active current instance. This is likely a bug.`
          );
        }
        let awaitable = getAwaitable();
        unsetCurrentInstance();
        if (inSSRSetup) {
          setInSSRSetupState(false);
        }
        const restore = () => {
          setCurrentInstance(ctx);
          if (inSSRSetup) {
            setInSSRSetupState(true);
          }
        };
        const cleanup = () => {
          if (getCurrentInstance() !== ctx) ctx.scope.off();
          unsetCurrentInstance();
          if (inSSRSetup) {
            setInSSRSetupState(false);
          }
        };
        if (shared.isPromise(awaitable)) {
          awaitable = awaitable.catch((e) => {
            restore();
            Promise.resolve().then(() => Promise.resolve().then(cleanup));
            throw e;
          });
        }
        return [
          awaitable,
          () => {
            restore();
            Promise.resolve().then(cleanup);
          }
        ];
      }
      function createDuplicateChecker() {
        const cache2 = /* @__PURE__ */ Object.create(null);
        return (type, key) => {
          if (cache2[key]) {
            warn$1(`${type} property "${key}" is already defined in ${cache2[key]}.`);
          } else {
            cache2[key] = type;
          }
        };
      }
      var shouldCacheAccess = true;
      function applyOptions(instance) {
        const options = resolveMergedOptions(instance);
        const publicThis = instance.proxy;
        const ctx = instance.ctx;
        shouldCacheAccess = false;
        if (options.beforeCreate) {
          callHook(options.beforeCreate, instance, "bc");
        }
        const {
          // state
          data: dataOptions,
          computed: computedOptions,
          methods,
          watch: watchOptions,
          provide: provideOptions,
          inject: injectOptions,
          // lifecycle
          created,
          beforeMount,
          mounted,
          beforeUpdate,
          updated,
          activated,
          deactivated,
          beforeDestroy,
          beforeUnmount,
          destroyed,
          unmounted,
          render: render2,
          renderTracked,
          renderTriggered,
          errorCaptured,
          serverPrefetch,
          // public API
          expose,
          inheritAttrs,
          // assets
          components,
          directives,
          filters
        } = options;
        const checkDuplicateProperties = createDuplicateChecker();
        {
          const [propsOptions] = instance.propsOptions;
          if (propsOptions) {
            for (const key in propsOptions) {
              checkDuplicateProperties("Props", key);
            }
          }
        }
        if (injectOptions) {
          resolveInjections(injectOptions, ctx, checkDuplicateProperties);
        }
        if (methods) {
          for (const key in methods) {
            const methodHandler = methods[key];
            if (shared.isFunction(methodHandler)) {
              {
                Object.defineProperty(ctx, key, {
                  value: methodHandler.bind(publicThis),
                  configurable: true,
                  enumerable: true,
                  writable: true
                });
              }
              {
                checkDuplicateProperties("Methods", key);
              }
            } else {
              warn$1(
                `Method "${key}" has type "${typeof methodHandler}" in the component definition. Did you reference the function correctly?`
              );
            }
          }
        }
        if (dataOptions) {
          if (!shared.isFunction(dataOptions)) {
            warn$1(
              `The data option must be a function. Plain object usage is no longer supported.`
            );
          }
          const data = dataOptions.call(publicThis, publicThis);
          if (shared.isPromise(data)) {
            warn$1(
              `data() returned a Promise - note data() cannot be async; If you intend to perform data fetching before component renders, use async setup() + <Suspense>.`
            );
          }
          if (!shared.isObject(data)) {
            warn$1(`data() should return an object.`);
          } else {
            instance.data = reactivity.reactive(data);
            {
              for (const key in data) {
                checkDuplicateProperties("Data", key);
                if (!isReservedPrefix(key[0])) {
                  Object.defineProperty(ctx, key, {
                    configurable: true,
                    enumerable: true,
                    get: () => data[key],
                    set: shared.NOOP
                  });
                }
              }
            }
          }
        }
        shouldCacheAccess = true;
        if (computedOptions) {
          for (const key in computedOptions) {
            const opt = computedOptions[key];
            const get = shared.isFunction(opt) ? opt.bind(publicThis, publicThis) : shared.isFunction(opt.get) ? opt.get.bind(publicThis, publicThis) : shared.NOOP;
            if (get === shared.NOOP) {
              warn$1(`Computed property "${key}" has no getter.`);
            }
            const set = !shared.isFunction(opt) && shared.isFunction(opt.set) ? opt.set.bind(publicThis) : () => {
              warn$1(
                `Write operation failed: computed property "${key}" is readonly.`
              );
            };
            const c = computed({
              get,
              set
            });
            Object.defineProperty(ctx, key, {
              enumerable: true,
              configurable: true,
              get: () => c.value,
              set: (v) => c.value = v
            });
            {
              checkDuplicateProperties("Computed", key);
            }
          }
        }
        if (watchOptions) {
          for (const key in watchOptions) {
            createWatcher(watchOptions[key], ctx, publicThis, key);
          }
        }
        if (provideOptions) {
          const provides = shared.isFunction(provideOptions) ? provideOptions.call(publicThis) : provideOptions;
          Reflect.ownKeys(provides).forEach((key) => {
            provide(key, provides[key]);
          });
        }
        if (created) {
          callHook(created, instance, "c");
        }
        function registerLifecycleHook(register, hook) {
          if (shared.isArray(hook)) {
            hook.forEach((_hook) => register(_hook.bind(publicThis)));
          } else if (hook) {
            register(hook.bind(publicThis));
          }
        }
        registerLifecycleHook(onBeforeMount, beforeMount);
        registerLifecycleHook(onMounted, mounted);
        registerLifecycleHook(onBeforeUpdate, beforeUpdate);
        registerLifecycleHook(onUpdated, updated);
        registerLifecycleHook(onActivated, activated);
        registerLifecycleHook(onDeactivated, deactivated);
        registerLifecycleHook(onErrorCaptured, errorCaptured);
        registerLifecycleHook(onRenderTracked, renderTracked);
        registerLifecycleHook(onRenderTriggered, renderTriggered);
        registerLifecycleHook(onBeforeUnmount, beforeUnmount);
        registerLifecycleHook(onUnmounted, unmounted);
        registerLifecycleHook(onServerPrefetch, serverPrefetch);
        if (shared.isArray(expose)) {
          if (expose.length) {
            const exposed = instance.exposed || (instance.exposed = {});
            expose.forEach((key) => {
              Object.defineProperty(exposed, key, {
                get: () => publicThis[key],
                set: (val) => publicThis[key] = val,
                enumerable: true
              });
            });
          } else if (!instance.exposed) {
            instance.exposed = {};
          }
        }
        if (render2 && instance.render === shared.NOOP) {
          instance.render = render2;
        }
        if (inheritAttrs != null) {
          instance.inheritAttrs = inheritAttrs;
        }
        if (components) instance.components = components;
        if (directives) instance.directives = directives;
        if (serverPrefetch) {
          markAsyncBoundary(instance);
        }
      }
      function resolveInjections(injectOptions, ctx, checkDuplicateProperties = shared.NOOP) {
        if (shared.isArray(injectOptions)) {
          injectOptions = normalizeInject(injectOptions);
        }
        for (const key in injectOptions) {
          const opt = injectOptions[key];
          let injected;
          if (shared.isObject(opt)) {
            if ("default" in opt) {
              injected = inject(
                opt.from || key,
                opt.default,
                true
              );
            } else {
              injected = inject(opt.from || key);
            }
          } else {
            injected = inject(opt);
          }
          if (reactivity.isRef(injected)) {
            Object.defineProperty(ctx, key, {
              enumerable: true,
              configurable: true,
              get: () => injected.value,
              set: (v) => injected.value = v
            });
          } else {
            ctx[key] = injected;
          }
          {
            checkDuplicateProperties("Inject", key);
          }
        }
      }
      function callHook(hook, instance, type) {
        callWithAsyncErrorHandling(
          shared.isArray(hook) ? hook.map((h3) => h3.bind(instance.proxy)) : hook.bind(instance.proxy),
          instance,
          type
        );
      }
      function createWatcher(raw, ctx, publicThis, key) {
        let getter = key.includes(".") ? createPathGetter(publicThis, key) : () => publicThis[key];
        if (shared.isString(raw)) {
          const handler = ctx[raw];
          if (shared.isFunction(handler)) {
            {
              watch(getter, handler);
            }
          } else {
            warn$1(`Invalid watch handler specified by key "${raw}"`, handler);
          }
        } else if (shared.isFunction(raw)) {
          {
            watch(getter, raw.bind(publicThis));
          }
        } else if (shared.isObject(raw)) {
          if (shared.isArray(raw)) {
            raw.forEach((r) => createWatcher(r, ctx, publicThis, key));
          } else {
            const handler = shared.isFunction(raw.handler) ? raw.handler.bind(publicThis) : ctx[raw.handler];
            if (shared.isFunction(handler)) {
              watch(getter, handler, raw);
            } else {
              warn$1(`Invalid watch handler specified by key "${raw.handler}"`, handler);
            }
          }
        } else {
          warn$1(`Invalid watch option: "${key}"`, raw);
        }
      }
      function resolveMergedOptions(instance) {
        const base = instance.type;
        const { mixins, extends: extendsOptions } = base;
        const {
          mixins: globalMixins,
          optionsCache: cache2,
          config: { optionMergeStrategies }
        } = instance.appContext;
        const cached = cache2.get(base);
        let resolved;
        if (cached) {
          resolved = cached;
        } else if (!globalMixins.length && !mixins && !extendsOptions) {
          {
            resolved = base;
          }
        } else {
          resolved = {};
          if (globalMixins.length) {
            globalMixins.forEach(
              (m) => mergeOptions(resolved, m, optionMergeStrategies, true)
            );
          }
          mergeOptions(resolved, base, optionMergeStrategies);
        }
        if (shared.isObject(base)) {
          cache2.set(base, resolved);
        }
        return resolved;
      }
      function mergeOptions(to, from, strats, asMixin = false) {
        const { mixins, extends: extendsOptions } = from;
        if (extendsOptions) {
          mergeOptions(to, extendsOptions, strats, true);
        }
        if (mixins) {
          mixins.forEach(
            (m) => mergeOptions(to, m, strats, true)
          );
        }
        for (const key in from) {
          if (asMixin && key === "expose") {
            warn$1(
              `"expose" option is ignored when declared in mixins or extends. It should only be declared in the base component itself.`
            );
          } else {
            const strat = internalOptionMergeStrats[key] || strats && strats[key];
            to[key] = strat ? strat(to[key], from[key]) : from[key];
          }
        }
        return to;
      }
      var internalOptionMergeStrats = {
        data: mergeDataFn,
        props: mergeEmitsOrPropsOptions,
        emits: mergeEmitsOrPropsOptions,
        // objects
        methods: mergeObjectOptions,
        computed: mergeObjectOptions,
        // lifecycle
        beforeCreate: mergeAsArray,
        created: mergeAsArray,
        beforeMount: mergeAsArray,
        mounted: mergeAsArray,
        beforeUpdate: mergeAsArray,
        updated: mergeAsArray,
        beforeDestroy: mergeAsArray,
        beforeUnmount: mergeAsArray,
        destroyed: mergeAsArray,
        unmounted: mergeAsArray,
        activated: mergeAsArray,
        deactivated: mergeAsArray,
        errorCaptured: mergeAsArray,
        serverPrefetch: mergeAsArray,
        // assets
        components: mergeObjectOptions,
        directives: mergeObjectOptions,
        // watch
        watch: mergeWatchOptions,
        // provide / inject
        provide: mergeDataFn,
        inject: mergeInject
      };
      function mergeDataFn(to, from) {
        if (!from) {
          return to;
        }
        if (!to) {
          return from;
        }
        return function mergedDataFn() {
          return shared.extend(
            shared.isFunction(to) ? to.call(this, this) : to,
            shared.isFunction(from) ? from.call(this, this) : from
          );
        };
      }
      function mergeInject(to, from) {
        return mergeObjectOptions(normalizeInject(to), normalizeInject(from));
      }
      function normalizeInject(raw) {
        if (shared.isArray(raw)) {
          const res = {};
          for (let i = 0; i < raw.length; i++) {
            res[raw[i]] = raw[i];
          }
          return res;
        }
        return raw;
      }
      function mergeAsArray(to, from) {
        return to ? [...new Set([].concat(to, from))] : from;
      }
      function mergeObjectOptions(to, from) {
        return to ? shared.extend(/* @__PURE__ */ Object.create(null), to, from) : from;
      }
      function mergeEmitsOrPropsOptions(to, from) {
        if (to) {
          if (shared.isArray(to) && shared.isArray(from)) {
            return [.../* @__PURE__ */ new Set([...to, ...from])];
          }
          return shared.extend(
            /* @__PURE__ */ Object.create(null),
            normalizePropsOrEmits(to),
            normalizePropsOrEmits(from != null ? from : {})
          );
        } else {
          return from;
        }
      }
      function mergeWatchOptions(to, from) {
        if (!to) return from;
        if (!from) return to;
        const merged = shared.extend(/* @__PURE__ */ Object.create(null), to);
        for (const key in from) {
          merged[key] = mergeAsArray(to[key], from[key]);
        }
        return merged;
      }
      function createAppContext() {
        return {
          app: null,
          config: {
            isNativeTag: shared.NO,
            performance: false,
            globalProperties: {},
            optionMergeStrategies: {},
            errorHandler: void 0,
            warnHandler: void 0,
            compilerOptions: {}
          },
          mixins: [],
          components: {},
          directives: {},
          provides: /* @__PURE__ */ Object.create(null),
          optionsCache: /* @__PURE__ */ new WeakMap(),
          propsCache: /* @__PURE__ */ new WeakMap(),
          emitsCache: /* @__PURE__ */ new WeakMap()
        };
      }
      var uid$1 = 0;
      function createAppAPI(render2, hydrate) {
        return function createApp2(rootComponent, rootProps = null) {
          if (!shared.isFunction(rootComponent)) {
            rootComponent = shared.extend({}, rootComponent);
          }
          if (rootProps != null && !shared.isObject(rootProps)) {
            warn$1(`root props passed to app.mount() must be an object.`);
            rootProps = null;
          }
          const context = createAppContext();
          const installedPlugins = /* @__PURE__ */ new WeakSet();
          const pluginCleanupFns = [];
          let isMounted = false;
          const app = context.app = {
            _uid: uid$1++,
            _component: rootComponent,
            _props: rootProps,
            _container: null,
            _context: context,
            _instance: null,
            version,
            get config() {
              return context.config;
            },
            set config(v) {
              {
                warn$1(
                  `app.config cannot be replaced. Modify individual options instead.`
                );
              }
            },
            use(plugin, ...options) {
              if (installedPlugins.has(plugin)) {
                warn$1(`Plugin has already been applied to target app.`);
              } else if (plugin && shared.isFunction(plugin.install)) {
                installedPlugins.add(plugin);
                plugin.install(app, ...options);
              } else if (shared.isFunction(plugin)) {
                installedPlugins.add(plugin);
                plugin(app, ...options);
              } else {
                warn$1(
                  `A plugin must either be a function or an object with an "install" function.`
                );
              }
              return app;
            },
            mixin(mixin) {
              {
                if (!context.mixins.includes(mixin)) {
                  context.mixins.push(mixin);
                } else {
                  warn$1(
                    "Mixin has already been applied to target app" + (mixin.name ? `: ${mixin.name}` : "")
                  );
                }
              }
              return app;
            },
            component(name, component) {
              {
                validateComponentName(name, context.config);
              }
              if (!component) {
                return context.components[name];
              }
              if (context.components[name]) {
                warn$1(`Component "${name}" has already been registered in target app.`);
              }
              context.components[name] = component;
              return app;
            },
            directive(name, directive) {
              {
                validateDirectiveName(name);
              }
              if (!directive) {
                return context.directives[name];
              }
              if (context.directives[name]) {
                warn$1(`Directive "${name}" has already been registered in target app.`);
              }
              context.directives[name] = directive;
              return app;
            },
            mount(rootContainer, isHydrate, namespace) {
              if (!isMounted) {
                if (rootContainer.__vue_app__) {
                  warn$1(
                    `There is already an app instance mounted on the host container.
 If you want to mount another app on the same host container, you need to unmount the previous app by calling \`app.unmount()\` first.`
                  );
                }
                const vnode = app._ceVNode || createVNode(rootComponent, rootProps);
                vnode.appContext = context;
                if (namespace === true) {
                  namespace = "svg";
                } else if (namespace === false) {
                  namespace = void 0;
                }
                {
                  context.reload = () => {
                    const cloned = cloneVNode(vnode);
                    cloned.el = null;
                    render2(cloned, rootContainer, namespace);
                  };
                }
                if (isHydrate && hydrate) {
                  hydrate(vnode, rootContainer);
                } else {
                  render2(vnode, rootContainer, namespace);
                }
                isMounted = true;
                app._container = rootContainer;
                rootContainer.__vue_app__ = app;
                {
                  app._instance = vnode.component;
                  devtoolsInitApp(app, version);
                }
                return getComponentPublicInstance(vnode.component);
              } else {
                warn$1(
                  `App has already been mounted.
If you want to remount the same app, move your app creation logic into a factory function and create fresh app instances for each mount - e.g. \`const createMyApp = () => createApp(App)\``
                );
              }
            },
            onUnmount(cleanupFn) {
              if (typeof cleanupFn !== "function") {
                warn$1(
                  `Expected function as first argument to app.onUnmount(), but got ${typeof cleanupFn}`
                );
              }
              pluginCleanupFns.push(cleanupFn);
            },
            unmount() {
              if (isMounted) {
                callWithAsyncErrorHandling(
                  pluginCleanupFns,
                  app._instance,
                  16
                );
                render2(null, app._container);
                {
                  app._instance = null;
                  devtoolsUnmountApp(app);
                }
                delete app._container.__vue_app__;
              } else {
                warn$1(`Cannot unmount an app that is not mounted.`);
              }
            },
            provide(key, value) {
              if (key in context.provides) {
                if (shared.hasOwn(context.provides, key)) {
                  warn$1(
                    `App already provides property with key "${String(key)}". It will be overwritten with the new value.`
                  );
                } else {
                  warn$1(
                    `App already provides property with key "${String(key)}" inherited from its parent element. It will be overwritten with the new value.`
                  );
                }
              }
              context.provides[key] = value;
              return app;
            },
            runWithContext(fn) {
              const lastApp = currentApp;
              currentApp = app;
              try {
                return fn();
              } finally {
                currentApp = lastApp;
              }
            }
          };
          return app;
        };
      }
      var currentApp = null;
      function useModel(props, name, options = shared.EMPTY_OBJ) {
        const i = getCurrentInstance();
        if (!i) {
          warn$1(`useModel() called without active instance.`);
          return reactivity.ref();
        }
        const camelizedName = shared.camelize(name);
        if (!i.propsOptions[0][camelizedName]) {
          warn$1(`useModel() called with prop "${name}" which is not declared.`);
          return reactivity.ref();
        }
        const hyphenatedName = shared.hyphenate(name);
        const modifiers = getModelModifiers(props, camelizedName);
        const res = reactivity.customRef((track2, trigger) => {
          let localValue;
          let prevSetValue = shared.EMPTY_OBJ;
          let prevEmittedValue;
          watchSyncEffect(() => {
            const propValue = props[camelizedName];
            if (shared.hasChanged(localValue, propValue)) {
              localValue = propValue;
              trigger();
            }
          });
          return {
            get() {
              track2();
              return options.get ? options.get(localValue) : localValue;
            },
            set(value) {
              const emittedValue = options.set ? options.set(value) : value;
              if (!shared.hasChanged(emittedValue, localValue) && !(prevSetValue !== shared.EMPTY_OBJ && shared.hasChanged(value, prevSetValue))) {
                return;
              }
              const rawProps = i.vnode.props;
              const hasVModel = !!(rawProps && // check if parent has passed v-model
              (name in rawProps || camelizedName in rawProps || hyphenatedName in rawProps) && (`onUpdate:${name}` in rawProps || `onUpdate:${camelizedName}` in rawProps || `onUpdate:${hyphenatedName}` in rawProps));
              if (!hasVModel) {
                localValue = value;
                trigger();
              }
              i.emit(`update:${name}`, emittedValue);
              if (shared.hasChanged(value, prevSetValue) && (shared.hasChanged(value, emittedValue) && !shared.hasChanged(emittedValue, prevEmittedValue) || // #13524: browsers differ in when they flush microtasks between
              // event listeners. If a v-model listener emits an intermediate value
              // and a following listener restores the model to its previous prop
              // value before parent updates are flushed, the parent render can be
              // deduped as having no prop change. Force a local update so DOM state
              // such as an input's value is synchronized back to the current model.
              hasVModel && prevSetValue !== shared.EMPTY_OBJ && !shared.hasChanged(emittedValue, localValue))) {
                trigger();
              }
              prevSetValue = value;
              prevEmittedValue = emittedValue;
            }
          };
        });
        res[Symbol.iterator] = () => {
          let i2 = 0;
          return {
            next() {
              if (i2 < 2) {
                return { value: i2++ ? modifiers || shared.EMPTY_OBJ : res, done: false };
              } else {
                return { done: true };
              }
            }
          };
        };
        return res;
      }
      var getModelModifiers = (props, modelName) => {
        return modelName === "modelValue" || modelName === "model-value" ? props.modelModifiers : props[`${modelName}Modifiers`] || props[`${shared.camelize(modelName)}Modifiers`] || props[`${shared.hyphenate(modelName)}Modifiers`];
      };
      function emit(instance, event, ...rawArgs) {
        if (instance.isUnmounted) return;
        const props = instance.vnode.props || shared.EMPTY_OBJ;
        {
          const {
            emitsOptions,
            propsOptions: [propsOptions]
          } = instance;
          if (emitsOptions) {
            if (!(event in emitsOptions) && true) {
              if (!propsOptions || !(shared.toHandlerKey(shared.camelize(event)) in propsOptions)) {
                warn$1(
                  `Component emitted event "${event}" but it is neither declared in the emits option nor as an "${shared.toHandlerKey(shared.camelize(event))}" prop.`
                );
              }
            } else {
              const validator = emitsOptions[event];
              if (shared.isFunction(validator)) {
                const isValid = validator(...rawArgs);
                if (!isValid) {
                  warn$1(
                    `Invalid event arguments: event validation failed for event "${event}".`
                  );
                }
              }
            }
          }
        }
        let args = rawArgs;
        const isModelListener = event.startsWith("update:");
        const modifiers = isModelListener && getModelModifiers(props, event.slice(7));
        if (modifiers) {
          if (modifiers.trim) {
            args = rawArgs.map((a) => shared.isString(a) ? a.trim() : a);
          }
          if (modifiers.number) {
            args = args.map(shared.looseToNumber);
          }
        }
        {
          devtoolsComponentEmit(instance, event, args);
        }
        {
          const lowerCaseEvent = event.toLowerCase();
          if (lowerCaseEvent !== event && props[shared.toHandlerKey(lowerCaseEvent)]) {
            warn$1(
              `Event "${lowerCaseEvent}" is emitted in component ${formatComponentName(
                instance,
                instance.type
              )} but the handler is registered for "${event}". Note that HTML attributes are case-insensitive and you cannot use v-on to listen to camelCase events when using in-DOM templates. You should probably use "${shared.hyphenate(
                event
              )}" instead of "${event}".`
            );
          }
        }
        let handlerName;
        let handler = props[handlerName = shared.toHandlerKey(event)] || // also try camelCase event handler (#2249)
        props[handlerName = shared.toHandlerKey(shared.camelize(event))];
        if (!handler && isModelListener) {
          handler = props[handlerName = shared.toHandlerKey(shared.hyphenate(event))];
        }
        if (handler) {
          callWithAsyncErrorHandling(
            handler,
            instance,
            6,
            args
          );
        }
        const onceHandler = props[handlerName + `Once`];
        if (onceHandler) {
          if (!instance.emitted) {
            instance.emitted = {};
          } else if (instance.emitted[handlerName]) {
            return;
          }
          instance.emitted[handlerName] = true;
          callWithAsyncErrorHandling(
            onceHandler,
            instance,
            6,
            args
          );
        }
      }
      var mixinEmitsCache = /* @__PURE__ */ new WeakMap();
      function normalizeEmitsOptions(comp, appContext, asMixin = false) {
        const cache2 = asMixin ? mixinEmitsCache : appContext.emitsCache;
        const cached = cache2.get(comp);
        if (cached !== void 0) {
          return cached;
        }
        const raw = comp.emits;
        let normalized = {};
        let hasExtends = false;
        if (!shared.isFunction(comp)) {
          const extendEmits = (raw2) => {
            const normalizedFromExtend = normalizeEmitsOptions(raw2, appContext, true);
            if (normalizedFromExtend) {
              hasExtends = true;
              shared.extend(normalized, normalizedFromExtend);
            }
          };
          if (!asMixin && appContext.mixins.length) {
            appContext.mixins.forEach(extendEmits);
          }
          if (comp.extends) {
            extendEmits(comp.extends);
          }
          if (comp.mixins) {
            comp.mixins.forEach(extendEmits);
          }
        }
        if (!raw && !hasExtends) {
          if (shared.isObject(comp)) {
            cache2.set(comp, null);
          }
          return null;
        }
        if (shared.isArray(raw)) {
          raw.forEach((key) => normalized[key] = null);
        } else {
          shared.extend(normalized, raw);
        }
        if (shared.isObject(comp)) {
          cache2.set(comp, normalized);
        }
        return normalized;
      }
      function isEmitListener(options, key) {
        if (!options || !shared.isOn(key)) {
          return false;
        }
        key = key.slice(2);
        key = key === "Once" ? key : key.replace(/Once$/, "");
        return shared.hasOwn(options, key[0].toLowerCase() + key.slice(1)) || shared.hasOwn(options, shared.hyphenate(key)) || shared.hasOwn(options, key);
      }
      var accessedAttrs = false;
      function markAttrsAccessed() {
        accessedAttrs = true;
      }
      function renderComponentRoot(instance) {
        const {
          type: Component,
          vnode,
          proxy,
          withProxy,
          propsOptions: [propsOptions],
          slots,
          attrs,
          emit: emit2,
          render: render2,
          renderCache,
          props,
          data,
          setupState,
          ctx,
          inheritAttrs
        } = instance;
        const prev = setCurrentRenderingInstance(instance);
        let result;
        let fallthroughAttrs;
        {
          accessedAttrs = false;
        }
        try {
          if (vnode.shapeFlag & 4) {
            const proxyToUse = withProxy || proxy;
            const thisProxy = setupState.__isScriptSetup ? new Proxy(proxyToUse, {
              get(target, key, receiver) {
                warn$1(
                  `Property '${String(
                    key
                  )}' was accessed via 'this'. Avoid using 'this' in templates.`
                );
                return Reflect.get(target, key, receiver);
              }
            }) : proxyToUse;
            result = normalizeVNode(
              render2.call(
                thisProxy,
                proxyToUse,
                renderCache,
                true ? reactivity.shallowReadonly(props) : props,
                setupState,
                data,
                ctx
              )
            );
            fallthroughAttrs = attrs;
          } else {
            const render22 = Component;
            if (attrs === props) {
              markAttrsAccessed();
            }
            result = normalizeVNode(
              render22.length > 1 ? render22(
                true ? reactivity.shallowReadonly(props) : props,
                true ? {
                  get attrs() {
                    markAttrsAccessed();
                    return reactivity.shallowReadonly(attrs);
                  },
                  slots,
                  emit: emit2
                } : { attrs, slots, emit: emit2 }
              ) : render22(
                true ? reactivity.shallowReadonly(props) : props,
                null
              )
            );
            fallthroughAttrs = Component.props ? attrs : getFunctionalFallthrough(attrs);
          }
        } catch (err) {
          blockStack.length = 0;
          handleError(err, instance, 1);
          result = createVNode(Comment);
        }
        let root = result;
        let setRoot = void 0;
        if (result.patchFlag > 0 && result.patchFlag & 2048) {
          [root, setRoot] = getChildRoot(result);
        }
        if (fallthroughAttrs && inheritAttrs !== false) {
          const keys = Object.keys(fallthroughAttrs);
          const { shapeFlag } = root;
          if (keys.length) {
            if (shapeFlag & (1 | 6)) {
              if (propsOptions && keys.some(shared.isModelListener)) {
                fallthroughAttrs = filterModelListeners(
                  fallthroughAttrs,
                  propsOptions
                );
              }
              root = cloneVNode(root, fallthroughAttrs, false, true);
            } else if (!accessedAttrs && root.type !== Comment) {
              const allAttrs = Object.keys(attrs);
              const eventAttrs = [];
              const extraAttrs = [];
              for (let i = 0, l = allAttrs.length; i < l; i++) {
                const key = allAttrs[i];
                if (shared.isOn(key)) {
                  if (!shared.isModelListener(key)) {
                    eventAttrs.push(key[2].toLowerCase() + key.slice(3));
                  }
                } else {
                  extraAttrs.push(key);
                }
              }
              if (extraAttrs.length) {
                warn$1(
                  `Extraneous non-props attributes (${extraAttrs.join(", ")}) were passed to component but could not be automatically inherited because component renders fragment or text or teleport root nodes.`
                );
              }
              if (eventAttrs.length) {
                warn$1(
                  `Extraneous non-emits event listeners (${eventAttrs.join(", ")}) were passed to component but could not be automatically inherited because component renders fragment or text root nodes. If the listener is intended to be a component custom event listener only, declare it using the "emits" option.`
                );
              }
            }
          }
        }
        if (vnode.dirs) {
          if (!isElementRoot(root)) {
            warn$1(
              `Runtime directive used on component with non-element root node. The directives will not function as intended.`
            );
          }
          root = cloneVNode(root, null, false, true);
          root.dirs = root.dirs ? root.dirs.concat(vnode.dirs) : vnode.dirs;
        }
        if (vnode.transition) {
          const child = isTeleport(root.type) ? getInnerChild$1(root) || root : root;
          if (!isElementRoot(child)) {
            warn$1(
              `Component inside <Transition> renders non-element root node that cannot be animated.`
            );
          }
          setTransitionHooks(child, vnode.transition);
        }
        if (setRoot) {
          setRoot(root);
        } else {
          result = root;
        }
        setCurrentRenderingInstance(prev);
        return result;
      }
      var getChildRoot = (vnode) => {
        const rawChildren = vnode.children;
        const dynamicChildren = vnode.dynamicChildren;
        const childRoot = filterSingleRoot(rawChildren, false);
        if (!childRoot) {
          return [vnode, void 0];
        } else if (childRoot.patchFlag > 0 && childRoot.patchFlag & 2048) {
          return getChildRoot(childRoot);
        }
        const index = rawChildren.indexOf(childRoot);
        const dynamicIndex = dynamicChildren ? dynamicChildren.indexOf(childRoot) : -1;
        const setRoot = (updatedRoot) => {
          rawChildren[index] = updatedRoot;
          if (dynamicChildren) {
            if (dynamicIndex > -1) {
              dynamicChildren[dynamicIndex] = updatedRoot;
            } else if (updatedRoot.patchFlag > 0) {
              vnode.dynamicChildren = [...dynamicChildren, updatedRoot];
            }
          }
        };
        return [normalizeVNode(childRoot), setRoot];
      };
      function filterSingleRoot(children, recurse = true) {
        let singleRoot;
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (isVNode(child)) {
            if (child.type !== Comment || child.children === "v-if") {
              if (singleRoot) {
                return;
              } else {
                singleRoot = child;
                if (recurse && singleRoot.patchFlag > 0 && singleRoot.patchFlag & 2048) {
                  return filterSingleRoot(singleRoot.children);
                }
              }
            }
          } else {
            return;
          }
        }
        return singleRoot;
      }
      var getFunctionalFallthrough = (attrs) => {
        let res;
        for (const key in attrs) {
          if (key === "class" || key === "style" || shared.isOn(key)) {
            (res || (res = {}))[key] = attrs[key];
          }
        }
        return res;
      };
      var filterModelListeners = (attrs, props) => {
        const res = {};
        for (const key in attrs) {
          if (!shared.isModelListener(key) || !(key.slice(9) in props)) {
            res[key] = attrs[key];
          }
        }
        return res;
      };
      var isElementRoot = (vnode) => {
        return vnode.shapeFlag & (6 | 1) || vnode.type === Comment;
      };
      function shouldUpdateComponent(prevVNode, nextVNode, optimized) {
        const { props: prevProps, children: prevChildren, component } = prevVNode;
        const { props: nextProps, children: nextChildren, patchFlag } = nextVNode;
        const emits = component.emitsOptions;
        if ((prevChildren || nextChildren) && isHmrUpdating) {
          return true;
        }
        if (nextVNode.dirs || nextVNode.transition) {
          return true;
        }
        if (optimized && patchFlag >= 0) {
          if (patchFlag & 1024) {
            return true;
          }
          if (patchFlag & 16) {
            if (!prevProps) {
              return !!nextProps;
            }
            return hasPropsChanged(prevProps, nextProps, emits);
          } else if (patchFlag & 8) {
            const dynamicProps = nextVNode.dynamicProps;
            for (let i = 0; i < dynamicProps.length; i++) {
              const key = dynamicProps[i];
              if (hasPropValueChanged(nextProps, prevProps, key) && !isEmitListener(emits, key)) {
                return true;
              }
            }
          }
        } else {
          if (prevChildren || nextChildren) {
            if (!nextChildren || !nextChildren.$stable) {
              return true;
            }
          }
          if (prevProps === nextProps) {
            return false;
          }
          if (!prevProps) {
            return !!nextProps;
          }
          if (!nextProps) {
            return true;
          }
          return hasPropsChanged(prevProps, nextProps, emits);
        }
        return false;
      }
      function hasPropsChanged(prevProps, nextProps, emitsOptions) {
        const nextKeys = Object.keys(nextProps);
        if (nextKeys.length !== Object.keys(prevProps).length) {
          return true;
        }
        for (let i = 0; i < nextKeys.length; i++) {
          const key = nextKeys[i];
          if (hasPropValueChanged(nextProps, prevProps, key) && !isEmitListener(emitsOptions, key)) {
            return true;
          }
        }
        return false;
      }
      function hasPropValueChanged(nextProps, prevProps, key) {
        const nextProp = nextProps[key];
        const prevProp = prevProps[key];
        if (key === "style" && shared.isObject(nextProp) && shared.isObject(prevProp)) {
          return !shared.looseEqual(nextProp, prevProp);
        }
        return nextProp !== prevProp;
      }
      function updateHOCHostEl({ vnode, parent, suspense }, el) {
        while (parent) {
          const root = parent.subTree;
          if (root.suspense && root.suspense.activeBranch === vnode) {
            root.suspense.vnode.el = root.el = el;
            vnode = root;
          }
          if (root === vnode) {
            (vnode = parent.vnode).el = el;
            parent = parent.parent;
          } else {
            break;
          }
        }
        if (suspense && suspense.activeBranch === vnode) {
          suspense.vnode.el = el;
        }
      }
      var internalObjectProto = {};
      var createInternalObject = () => Object.create(internalObjectProto);
      var isInternalObject = (obj) => Object.getPrototypeOf(obj) === internalObjectProto;
      function initProps(instance, rawProps, isStateful, isSSR = false) {
        const props = {};
        const attrs = createInternalObject();
        instance.propsDefaults = /* @__PURE__ */ Object.create(null);
        setFullProps(instance, rawProps, props, attrs);
        for (const key in instance.propsOptions[0]) {
          if (!(key in props)) {
            props[key] = void 0;
          }
        }
        {
          validateProps(rawProps || {}, props, instance);
        }
        if (isStateful) {
          instance.props = isSSR ? props : reactivity.shallowReactive(props);
        } else {
          if (!instance.type.props) {
            instance.props = attrs;
          } else {
            instance.props = props;
          }
        }
        instance.attrs = attrs;
      }
      function isInHmrContext(instance) {
        while (instance) {
          if (instance.type.__hmrId) return true;
          instance = instance.parent;
        }
      }
      function updateProps(instance, rawProps, rawPrevProps, optimized) {
        const {
          props,
          attrs,
          vnode: { patchFlag }
        } = instance;
        const rawCurrentProps = reactivity.toRaw(props);
        const [options] = instance.propsOptions;
        let hasAttrsChanged = false;
        if (
          // always force full diff in dev
          // - #1942 if hmr is enabled with sfc component
          // - vite#872 non-sfc component used by sfc component
          !isInHmrContext(instance) && (optimized || patchFlag > 0) && !(patchFlag & 16)
        ) {
          if (patchFlag & 8) {
            const propsToUpdate = instance.vnode.dynamicProps;
            for (let i = 0; i < propsToUpdate.length; i++) {
              let key = propsToUpdate[i];
              if (isEmitListener(instance.emitsOptions, key)) {
                continue;
              }
              const value = rawProps[key];
              if (options) {
                if (shared.hasOwn(attrs, key)) {
                  if (value !== attrs[key]) {
                    attrs[key] = value;
                    hasAttrsChanged = true;
                  }
                } else {
                  const camelizedKey = shared.camelize(key);
                  props[camelizedKey] = resolvePropValue(
                    options,
                    rawCurrentProps,
                    camelizedKey,
                    value,
                    instance,
                    false
                  );
                }
              } else {
                if (value !== attrs[key]) {
                  attrs[key] = value;
                  hasAttrsChanged = true;
                }
              }
            }
          }
        } else {
          if (setFullProps(instance, rawProps, props, attrs)) {
            hasAttrsChanged = true;
          }
          let kebabKey;
          for (const key in rawCurrentProps) {
            if (!rawProps || // for camelCase
            !shared.hasOwn(rawProps, key) && // it's possible the original props was passed in as kebab-case
            // and converted to camelCase (#955)
            ((kebabKey = shared.hyphenate(key)) === key || !shared.hasOwn(rawProps, kebabKey))) {
              if (options) {
                if (rawPrevProps && // for camelCase
                (rawPrevProps[key] !== void 0 || // for kebab-case
                rawPrevProps[kebabKey] !== void 0)) {
                  props[key] = resolvePropValue(
                    options,
                    rawCurrentProps,
                    key,
                    void 0,
                    instance,
                    true
                  );
                }
              } else {
                delete props[key];
              }
            }
          }
          if (attrs !== rawCurrentProps) {
            for (const key in attrs) {
              if (!rawProps || !shared.hasOwn(rawProps, key) && true) {
                delete attrs[key];
                hasAttrsChanged = true;
              }
            }
          }
        }
        if (hasAttrsChanged) {
          reactivity.trigger(instance.attrs, "set", "");
        }
        {
          validateProps(rawProps || {}, props, instance);
        }
      }
      function setFullProps(instance, rawProps, props, attrs) {
        const [options, needCastKeys] = instance.propsOptions;
        let hasAttrsChanged = false;
        let rawCastValues;
        if (rawProps) {
          for (let key in rawProps) {
            if (shared.isReservedProp(key)) {
              continue;
            }
            const value = rawProps[key];
            let camelKey;
            if (options && shared.hasOwn(options, camelKey = shared.camelize(key))) {
              if (!needCastKeys || !needCastKeys.includes(camelKey)) {
                props[camelKey] = value;
              } else {
                (rawCastValues || (rawCastValues = {}))[camelKey] = value;
              }
            } else if (!isEmitListener(instance.emitsOptions, key)) {
              if (!(key in attrs) || value !== attrs[key]) {
                attrs[key] = value;
                hasAttrsChanged = true;
              }
            }
          }
        }
        if (needCastKeys) {
          const rawCurrentProps = reactivity.toRaw(props);
          const castValues = rawCastValues || shared.EMPTY_OBJ;
          for (let i = 0; i < needCastKeys.length; i++) {
            const key = needCastKeys[i];
            props[key] = resolvePropValue(
              options,
              rawCurrentProps,
              key,
              castValues[key],
              instance,
              !shared.hasOwn(castValues, key)
            );
          }
        }
        return hasAttrsChanged;
      }
      function resolvePropValue(options, props, key, value, instance, isAbsent) {
        const opt = options[key];
        if (opt != null) {
          const hasDefault = shared.hasOwn(opt, "default");
          if (hasDefault && value === void 0) {
            const defaultValue = opt.default;
            if (opt.type !== Function && !opt.skipFactory && shared.isFunction(defaultValue)) {
              const { propsDefaults } = instance;
              if (key in propsDefaults) {
                value = propsDefaults[key];
              } else {
                const reset = setCurrentInstance(instance);
                value = propsDefaults[key] = defaultValue.call(
                  null,
                  props
                );
                reset();
              }
            } else {
              value = defaultValue;
            }
            if (instance.ce) {
              instance.ce._setProp(key, value);
            }
          }
          if (opt[
            0
            /* shouldCast */
          ]) {
            if (isAbsent && !hasDefault) {
              value = false;
            } else if (opt[
              1
              /* shouldCastTrue */
            ] && (value === "" || value === shared.hyphenate(key))) {
              value = true;
            }
          }
        }
        return value;
      }
      var mixinPropsCache = /* @__PURE__ */ new WeakMap();
      function normalizePropsOptions(comp, appContext, asMixin = false) {
        const cache2 = asMixin ? mixinPropsCache : appContext.propsCache;
        const cached = cache2.get(comp);
        if (cached) {
          return cached;
        }
        const raw = comp.props;
        const normalized = {};
        const needCastKeys = [];
        let hasExtends = false;
        if (!shared.isFunction(comp)) {
          const extendProps = (raw2) => {
            hasExtends = true;
            const [props, keys] = normalizePropsOptions(raw2, appContext, true);
            shared.extend(normalized, props);
            if (keys) needCastKeys.push(...keys);
          };
          if (!asMixin && appContext.mixins.length) {
            appContext.mixins.forEach(extendProps);
          }
          if (comp.extends) {
            extendProps(comp.extends);
          }
          if (comp.mixins) {
            comp.mixins.forEach(extendProps);
          }
        }
        if (!raw && !hasExtends) {
          if (shared.isObject(comp)) {
            cache2.set(comp, shared.EMPTY_ARR);
          }
          return shared.EMPTY_ARR;
        }
        if (shared.isArray(raw)) {
          for (let i = 0; i < raw.length; i++) {
            if (!shared.isString(raw[i])) {
              warn$1(`props must be strings when using array syntax.`, raw[i]);
            }
            const normalizedKey = shared.camelize(raw[i]);
            if (validatePropName(normalizedKey)) {
              normalized[normalizedKey] = shared.EMPTY_OBJ;
            }
          }
        } else if (raw) {
          if (!shared.isObject(raw)) {
            warn$1(`invalid props options`, raw);
          }
          for (const key in raw) {
            const normalizedKey = shared.camelize(key);
            if (validatePropName(normalizedKey)) {
              const opt = raw[key];
              const prop = normalized[normalizedKey] = shared.isArray(opt) || shared.isFunction(opt) ? { type: opt } : shared.extend({}, opt);
              const propType = prop.type;
              let shouldCast = false;
              let shouldCastTrue = true;
              if (shared.isArray(propType)) {
                for (let index = 0; index < propType.length; ++index) {
                  const type = propType[index];
                  const typeName = shared.isFunction(type) && type.name;
                  if (typeName === "Boolean") {
                    shouldCast = true;
                    break;
                  } else if (typeName === "String") {
                    shouldCastTrue = false;
                  }
                }
              } else {
                shouldCast = shared.isFunction(propType) && propType.name === "Boolean";
              }
              prop[
                0
                /* shouldCast */
              ] = shouldCast;
              prop[
                1
                /* shouldCastTrue */
              ] = shouldCastTrue;
              if (shouldCast || shared.hasOwn(prop, "default")) {
                needCastKeys.push(normalizedKey);
              }
            }
          }
        }
        const res = [normalized, needCastKeys];
        if (shared.isObject(comp)) {
          cache2.set(comp, res);
        }
        return res;
      }
      function validatePropName(key) {
        if (key[0] !== "$" && !shared.isReservedProp(key)) {
          return true;
        } else {
          warn$1(`Invalid prop name: "${key}" is a reserved property.`);
        }
        return false;
      }
      function getType(ctor) {
        if (ctor === null) {
          return "null";
        }
        if (typeof ctor === "function") {
          return ctor.name || "";
        } else if (typeof ctor === "object") {
          const name = ctor.constructor && ctor.constructor.name;
          return name || "";
        }
        return "";
      }
      function validateProps(rawProps, props, instance) {
        const resolvedValues = reactivity.toRaw(props);
        const options = instance.propsOptions[0];
        const camelizePropsKey = Object.keys(rawProps).map((key) => shared.camelize(key));
        for (const key in options) {
          let opt = options[key];
          if (opt == null) continue;
          validateProp(
            key,
            resolvedValues[key],
            opt,
            reactivity.shallowReadonly(resolvedValues),
            !camelizePropsKey.includes(key)
          );
        }
      }
      function validateProp(name, value, prop, props, isAbsent) {
        const { type, required, validator, skipCheck } = prop;
        if (required && isAbsent) {
          warn$1('Missing required prop: "' + name + '"');
          return;
        }
        if (value == null && !required) {
          return;
        }
        if (type != null && type !== true && !skipCheck) {
          let isValid = false;
          const types = shared.isArray(type) ? type : [type];
          const expectedTypes = [];
          for (let i = 0; i < types.length && !isValid; i++) {
            const { valid, expectedType } = assertType(value, types[i]);
            expectedTypes.push(expectedType || "");
            isValid = valid;
          }
          if (!isValid) {
            warn$1(getInvalidTypeMessage(name, value, expectedTypes));
            return;
          }
        }
        if (validator && !validator(value, props)) {
          warn$1('Invalid prop: custom validator check failed for prop "' + name + '".');
        }
      }
      var isSimpleType = /* @__PURE__ */ shared.makeMap(
        "String,Number,Boolean,Function,Symbol,BigInt"
      );
      function assertType(value, type) {
        let valid;
        const expectedType = getType(type);
        if (expectedType === "null") {
          valid = value === null;
        } else if (isSimpleType(expectedType)) {
          const t = typeof value;
          valid = t === expectedType.toLowerCase();
          if (!valid && t === "object") {
            valid = value instanceof type;
          }
        } else if (expectedType === "Object") {
          valid = shared.isObject(value);
        } else if (expectedType === "Array") {
          valid = shared.isArray(value);
        } else {
          valid = value instanceof type;
        }
        return {
          valid,
          expectedType
        };
      }
      function getInvalidTypeMessage(name, value, expectedTypes) {
        if (expectedTypes.length === 0) {
          return `Prop type [] for prop "${name}" won't match anything. Did you mean to use type Array instead?`;
        }
        let message = `Invalid prop: type check failed for prop "${name}". Expected ${expectedTypes.map(shared.capitalize).join(" | ")}`;
        const expectedType = expectedTypes[0];
        const receivedType = shared.toRawType(value);
        const expectedValue = styleValue(value, expectedType);
        const receivedValue = styleValue(value, receivedType);
        if (expectedTypes.length === 1 && isExplicable(expectedType) && isCoercible(expectedType, receivedType)) {
          message += ` with value ${expectedValue}`;
        }
        message += `, got ${receivedType} `;
        if (isExplicable(receivedType)) {
          message += `with value ${receivedValue}.`;
        }
        return message;
      }
      function styleValue(value, type) {
        if (shared.isSymbol(value)) {
          return value.toString();
        } else if (type === "String") {
          return `"${value}"`;
        } else if (type === "Number") {
          return `${Number(value)}`;
        } else {
          return `${value}`;
        }
      }
      function isExplicable(type) {
        const explicitTypes = ["string", "number", "boolean"];
        return explicitTypes.some((elem) => type.toLowerCase() === elem);
      }
      function isCoercible(...args) {
        return args.every((elem) => {
          const value = elem.toLowerCase();
          return value !== "boolean" && value !== "symbol";
        });
      }
      var isInternalKey = (key) => key === "_" || key === "_ctx" || key === "$stable";
      var normalizeSlotValue = (value) => shared.isArray(value) ? value.map(normalizeVNode) : [normalizeVNode(value)];
      var normalizeSlot = (key, rawSlot, ctx) => {
        if (rawSlot._n) {
          return rawSlot;
        }
        const normalized = withCtx((...args) => {
          if (currentInstance && !(ctx === null && currentRenderingInstance) && !(ctx && ctx.root !== currentInstance.root)) {
            warn$1(
              `Slot "${key}" invoked outside of the render function: this will not track dependencies used in the slot. Invoke the slot function inside the render function instead.`
            );
          }
          return normalizeSlotValue(rawSlot(...args));
        }, ctx);
        normalized._c = false;
        return normalized;
      };
      var normalizeObjectSlots = (rawSlots, slots, instance) => {
        const ctx = rawSlots._ctx;
        for (const key in rawSlots) {
          if (isInternalKey(key)) continue;
          const value = rawSlots[key];
          if (shared.isFunction(value)) {
            slots[key] = normalizeSlot(key, value, ctx);
          } else if (value != null) {
            {
              warn$1(
                `Non-function value encountered for slot "${key}". Prefer function slots for better performance.`
              );
            }
            const normalized = normalizeSlotValue(value);
            slots[key] = () => normalized;
          }
        }
      };
      var normalizeVNodeSlots = (instance, children) => {
        if (!isKeepAlive(instance.vnode) && true) {
          warn$1(
            `Non-function value encountered for default slot. Prefer function slots for better performance.`
          );
        }
        const normalized = normalizeSlotValue(children);
        instance.slots.default = () => normalized;
      };
      var assignSlots = (slots, children, optimized) => {
        for (const key in children) {
          if (optimized || !isInternalKey(key)) {
            slots[key] = children[key];
          }
        }
      };
      var initSlots = (instance, children, optimized) => {
        const slots = instance.slots = createInternalObject();
        if (instance.vnode.shapeFlag & 32) {
          const type = children._;
          if (type) {
            assignSlots(slots, children, optimized);
            if (optimized) {
              shared.def(slots, "_", type, true);
            }
          } else {
            normalizeObjectSlots(children, slots);
          }
        } else if (children) {
          normalizeVNodeSlots(instance, children);
        }
      };
      var updateSlots = (instance, children, optimized) => {
        const { vnode, slots } = instance;
        let needDeletionCheck = true;
        let deletionComparisonTarget = shared.EMPTY_OBJ;
        if (vnode.shapeFlag & 32) {
          const type = children._;
          if (type) {
            if (isHmrUpdating) {
              assignSlots(slots, children, optimized);
              reactivity.trigger(instance, "set", "$slots");
            } else if (optimized && type === 1) {
              needDeletionCheck = false;
            } else {
              assignSlots(slots, children, optimized);
            }
          } else {
            needDeletionCheck = !children.$stable;
            normalizeObjectSlots(children, slots);
          }
          deletionComparisonTarget = children;
        } else if (children) {
          normalizeVNodeSlots(instance, children);
          deletionComparisonTarget = { default: 1 };
        }
        if (needDeletionCheck) {
          for (const key in slots) {
            if (!isInternalKey(key) && deletionComparisonTarget[key] == null) {
              delete slots[key];
            }
          }
        }
      };
      var supported;
      var perf;
      function startMeasure(instance, type) {
        if (instance.appContext.config.performance && isSupported()) {
          perf.mark(`vue-${type}-${instance.uid}`);
        }
        {
          devtoolsPerfStart(instance, type, isSupported() ? perf.now() : Date.now());
        }
      }
      function endMeasure(instance, type) {
        if (instance.appContext.config.performance && isSupported()) {
          const startTag = `vue-${type}-${instance.uid}`;
          const endTag = startTag + `:end`;
          const measureName = `<${formatComponentName(instance, instance.type)}> ${type}`;
          perf.mark(endTag);
          perf.measure(measureName, startTag, endTag);
          perf.clearMeasures(measureName);
          perf.clearMarks(startTag);
          perf.clearMarks(endTag);
        }
        {
          devtoolsPerfEnd(instance, type, isSupported() ? perf.now() : Date.now());
        }
      }
      function isSupported() {
        if (supported !== void 0) {
          return supported;
        }
        if (typeof window !== "undefined" && window.performance) {
          supported = true;
          perf = window.performance;
        } else {
          supported = false;
        }
        return supported;
      }
      var queuePostRenderEffect = queueEffectWithSuspense;
      function createRenderer2(options) {
        return baseCreateRenderer(options);
      }
      function createHydrationRenderer(options) {
        return baseCreateRenderer(options, createHydrationFunctions);
      }
      function baseCreateRenderer(options, createHydrationFns) {
        const target = shared.getGlobalThis();
        target.__VUE__ = true;
        {
          setDevtoolsHook$1(target.__VUE_DEVTOOLS_GLOBAL_HOOK__, target);
        }
        const {
          insert: hostInsert,
          remove: hostRemove,
          patchProp: hostPatchProp,
          createElement: hostCreateElement,
          createText: hostCreateText,
          createComment: hostCreateComment,
          setText: hostSetText,
          setElementText: hostSetElementText,
          parentNode: hostParentNode,
          nextSibling: hostNextSibling,
          setScopeId: hostSetScopeId = shared.NOOP,
          insertStaticContent: hostInsertStaticContent
        } = options;
        const patch = (n1, n2, container, anchor = null, parentComponent = null, parentSuspense = null, namespace = void 0, slotScopeIds = null, optimized = isHmrUpdating ? false : !!n2.dynamicChildren) => {
          if (n1 === n2) {
            return;
          }
          if (n1 && !isSameVNodeType(n1, n2)) {
            anchor = getNextHostNode(n1);
            unmount(n1, parentComponent, parentSuspense, true);
            n1 = null;
          }
          if (n2.patchFlag === -2) {
            optimized = false;
            n2.dynamicChildren = null;
          }
          const { type, ref, shapeFlag } = n2;
          switch (type) {
            case Text:
              processText(n1, n2, container, anchor);
              break;
            case Comment:
              processCommentNode(n1, n2, container, anchor);
              break;
            case Static:
              if (n1 == null) {
                mountStaticNode(n2, container, anchor, namespace);
              } else {
                patchStaticNode(n1, n2, container, namespace);
              }
              break;
            case Fragment:
              processFragment(
                n1,
                n2,
                container,
                anchor,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
              break;
            default:
              if (shapeFlag & 1) {
                processElement(
                  n1,
                  n2,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
              } else if (shapeFlag & 6) {
                processComponent(
                  n1,
                  n2,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
              } else if (shapeFlag & 64) {
                type.process(
                  n1,
                  n2,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized,
                  internals
                );
              } else if (shapeFlag & 128) {
                type.process(
                  n1,
                  n2,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized,
                  internals
                );
              } else {
                warn$1("Invalid VNode type:", type, `(${typeof type})`);
              }
          }
          if (ref != null && parentComponent) {
            setRef(ref, n1 && n1.ref, parentSuspense, n2 || n1, !n2);
          } else if (ref == null && n1 && n1.ref != null) {
            setRef(n1.ref, null, parentSuspense, n1, true);
          }
        };
        const processText = (n1, n2, container, anchor) => {
          if (n1 == null) {
            hostInsert(
              n2.el = hostCreateText(n2.children),
              container,
              anchor
            );
          } else {
            const el = n2.el = n1.el;
            if (n2.children !== n1.children) {
              hostSetText(el, n2.children);
            }
          }
        };
        const processCommentNode = (n1, n2, container, anchor) => {
          if (n1 == null) {
            hostInsert(
              n2.el = hostCreateComment(n2.children || ""),
              container,
              anchor
            );
          } else {
            n2.el = n1.el;
          }
        };
        const mountStaticNode = (n2, container, anchor, namespace) => {
          [n2.el, n2.anchor] = hostInsertStaticContent(
            n2.children,
            container,
            anchor,
            namespace,
            n2.el,
            n2.anchor
          );
        };
        const patchStaticNode = (n1, n2, container, namespace) => {
          if (n2.children !== n1.children) {
            const anchor = hostNextSibling(n1.anchor);
            removeStaticNode(n1);
            [n2.el, n2.anchor] = hostInsertStaticContent(
              n2.children,
              container,
              anchor,
              namespace
            );
          } else {
            n2.el = n1.el;
            n2.anchor = n1.anchor;
          }
        };
        const moveStaticNode = ({ el, anchor }, container, nextSibling) => {
          let next;
          while (el && el !== anchor) {
            next = hostNextSibling(el);
            hostInsert(el, container, nextSibling);
            el = next;
          }
          hostInsert(anchor, container, nextSibling);
        };
        const removeStaticNode = ({ el, anchor }) => {
          let next;
          while (el && el !== anchor) {
            next = hostNextSibling(el);
            hostRemove(el);
            el = next;
          }
          hostRemove(anchor);
        };
        const processElement = (n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          if (n2.type === "svg") {
            namespace = "svg";
          } else if (n2.type === "math") {
            namespace = "mathml";
          }
          if (n1 == null) {
            mountElement(
              n2,
              container,
              anchor,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              optimized
            );
          } else {
            const customElement = n1.el && n1.el._isVueCE ? n1.el : null;
            try {
              if (customElement) {
                customElement._beginPatch();
              }
              patchElement(
                n1,
                n2,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
            } finally {
              if (customElement) {
                customElement._endPatch();
              }
            }
          }
        };
        const mountElement = (vnode, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          let el;
          let vnodeHook;
          const { props, shapeFlag, transition, dirs } = vnode;
          el = vnode.el = hostCreateElement(
            vnode.type,
            namespace,
            props && props.is,
            props
          );
          if (shapeFlag & 8) {
            hostSetElementText(el, vnode.children);
          } else if (shapeFlag & 16) {
            mountChildren(
              vnode.children,
              el,
              null,
              parentComponent,
              parentSuspense,
              resolveChildrenNamespace(vnode, namespace),
              slotScopeIds,
              optimized
            );
          }
          if (dirs) {
            invokeDirectiveHook(vnode, null, parentComponent, "created");
          }
          setScopeId(el, vnode, vnode.scopeId, slotScopeIds, parentComponent);
          if (props) {
            for (const key in props) {
              if (key !== "value" && !shared.isReservedProp(key)) {
                hostPatchProp(el, key, null, props[key], namespace, parentComponent);
              }
            }
            if ("value" in props) {
              hostPatchProp(el, "value", null, props.value, namespace);
            }
            if (vnodeHook = props.onVnodeBeforeMount) {
              invokeVNodeHook(vnodeHook, parentComponent, vnode);
            }
          }
          {
            shared.def(el, "__vnode", vnode, true);
            shared.def(el, "__vueParentComponent", parentComponent, true);
          }
          if (dirs) {
            invokeDirectiveHook(vnode, null, parentComponent, "beforeMount");
          }
          const needCallTransitionHooks = needTransition(parentSuspense, transition);
          if (needCallTransitionHooks) {
            transition.beforeEnter(el);
          }
          hostInsert(el, container, anchor);
          if ((vnodeHook = props && props.onVnodeMounted) || needCallTransitionHooks || dirs) {
            const isHmr = isHmrUpdating;
            queuePostRenderEffect(() => {
              let prev;
              prev = setHmrUpdating(isHmr);
              try {
                vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode);
                needCallTransitionHooks && transition.enter(el);
                dirs && invokeDirectiveHook(vnode, null, parentComponent, "mounted");
              } finally {
                setHmrUpdating(prev);
              }
            }, parentSuspense);
          }
        };
        const setScopeId = (el, vnode, scopeId, slotScopeIds, parentComponent) => {
          if (scopeId) {
            hostSetScopeId(el, scopeId);
          }
          if (slotScopeIds) {
            for (let i = 0; i < slotScopeIds.length; i++) {
              hostSetScopeId(el, slotScopeIds[i]);
            }
          }
          if (parentComponent) {
            let subTree = parentComponent.subTree;
            if (subTree.patchFlag > 0 && subTree.patchFlag & 2048) {
              subTree = filterSingleRoot(subTree.children) || subTree;
            }
            if (vnode === subTree || isSuspense(subTree.type) && (subTree.ssContent === vnode || subTree.ssFallback === vnode)) {
              const parentVNode = parentComponent.vnode;
              setScopeId(
                el,
                parentVNode,
                parentVNode.scopeId,
                parentVNode.slotScopeIds,
                parentComponent.parent
              );
            }
          }
        };
        const mountChildren = (children, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized, start = 0) => {
          for (let i = start; i < children.length; i++) {
            const child = children[i] = optimized ? cloneIfMounted(children[i]) : normalizeVNode(children[i]);
            patch(
              null,
              child,
              container,
              anchor,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              optimized
            );
          }
        };
        const patchElement = (n1, n2, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          const el = n2.el = n1.el;
          {
            el.__vnode = n2;
          }
          let { patchFlag, dynamicChildren, dirs } = n2;
          patchFlag |= n1.patchFlag & 16;
          const oldProps = n1.props || shared.EMPTY_OBJ;
          const newProps = n2.props || shared.EMPTY_OBJ;
          let vnodeHook;
          parentComponent && toggleRecurse(parentComponent, false);
          if (vnodeHook = newProps.onVnodeBeforeUpdate) {
            invokeVNodeHook(vnodeHook, parentComponent, n2, n1);
          }
          if (dirs) {
            invokeDirectiveHook(n2, n1, parentComponent, "beforeUpdate");
          }
          parentComponent && toggleRecurse(parentComponent, true);
          if (
            // HMR updated, force full diff
            isHmrUpdating || // #6385 the old vnode may be a user-wrapped non-isomorphic block
            // Force full diff when block metadata is unstable.
            dynamicChildren && (!n1.dynamicChildren || n1.dynamicChildren.length !== dynamicChildren.length)
          ) {
            patchFlag = 0;
            optimized = false;
            dynamicChildren = null;
          }
          if (oldProps.innerHTML && newProps.innerHTML == null || oldProps.textContent && newProps.textContent == null) {
            hostSetElementText(el, "");
          }
          if (dynamicChildren) {
            patchBlockChildren(
              n1.dynamicChildren,
              dynamicChildren,
              el,
              parentComponent,
              parentSuspense,
              resolveChildrenNamespace(n2, namespace),
              slotScopeIds
            );
            {
              traverseStaticChildren(n1, n2);
            }
          } else if (!optimized) {
            patchChildren(
              n1,
              n2,
              el,
              null,
              parentComponent,
              parentSuspense,
              resolveChildrenNamespace(n2, namespace),
              slotScopeIds,
              false
            );
          }
          if (patchFlag > 0) {
            if (patchFlag & 16) {
              patchProps(el, oldProps, newProps, parentComponent, namespace);
            } else {
              if (patchFlag & 2) {
                if (oldProps.class !== newProps.class) {
                  hostPatchProp(el, "class", null, newProps.class, namespace);
                }
              }
              if (patchFlag & 4) {
                hostPatchProp(el, "style", oldProps.style, newProps.style, namespace);
              }
              if (patchFlag & 8) {
                const propsToUpdate = n2.dynamicProps;
                for (let i = 0; i < propsToUpdate.length; i++) {
                  const key = propsToUpdate[i];
                  const prev = oldProps[key];
                  const next = newProps[key];
                  if (next !== prev || key === "value") {
                    hostPatchProp(el, key, prev, next, namespace, parentComponent);
                  }
                }
              }
            }
            if (patchFlag & 1) {
              if (n1.children !== n2.children) {
                hostSetElementText(el, n2.children);
              }
            }
          } else if (!optimized && dynamicChildren == null) {
            patchProps(el, oldProps, newProps, parentComponent, namespace);
          }
          if ((vnodeHook = newProps.onVnodeUpdated) || dirs) {
            queuePostRenderEffect(() => {
              vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, n2, n1);
              dirs && invokeDirectiveHook(n2, n1, parentComponent, "updated");
            }, parentSuspense);
          }
        };
        const patchBlockChildren = (oldChildren, newChildren, fallbackContainer, parentComponent, parentSuspense, namespace, slotScopeIds) => {
          for (let i = 0; i < newChildren.length; i++) {
            const oldVNode = oldChildren[i];
            const newVNode = newChildren[i];
            const container = (
              // oldVNode may be an errored async setup() component inside Suspense
              // which will not have a mounted element
              oldVNode.el && // - In the case of a Fragment, we need to provide the actual parent
              // of the Fragment itself so it can move its children.
              (oldVNode.type === Fragment || // - In the case of different nodes, there is going to be a replacement
              // which also requires the correct parent container
              !isSameVNodeType(oldVNode, newVNode) || // - In the case of a component, it could contain anything.
              oldVNode.shapeFlag & (6 | 64 | 128)) ? hostParentNode(oldVNode.el) : (
                // In other cases, the parent container is not actually used so we
                // just pass the block element here to avoid a DOM parentNode call.
                fallbackContainer
              )
            );
            patch(
              oldVNode,
              newVNode,
              container,
              null,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              true
            );
          }
        };
        const patchProps = (el, oldProps, newProps, parentComponent, namespace) => {
          if (oldProps !== newProps) {
            if (oldProps !== shared.EMPTY_OBJ) {
              for (const key in oldProps) {
                if (!shared.isReservedProp(key) && !(key in newProps)) {
                  hostPatchProp(
                    el,
                    key,
                    oldProps[key],
                    null,
                    namespace,
                    parentComponent
                  );
                }
              }
            }
            for (const key in newProps) {
              if (shared.isReservedProp(key)) continue;
              const next = newProps[key];
              const prev = oldProps[key];
              if (next !== prev && key !== "value") {
                hostPatchProp(el, key, prev, next, namespace, parentComponent);
              }
            }
            if ("value" in newProps) {
              hostPatchProp(el, "value", oldProps.value, newProps.value, namespace);
            }
          }
        };
        const processFragment = (n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          const fragmentStartAnchor = n2.el = n1 ? n1.el : hostCreateText("");
          const fragmentEndAnchor = n2.anchor = n1 ? n1.anchor : hostCreateText("");
          let { patchFlag, dynamicChildren, slotScopeIds: fragmentSlotScopeIds } = n2;
          if (
            // #5523 dev root fragment may inherit directives
            isHmrUpdating || patchFlag & 2048
          ) {
            patchFlag = 0;
            optimized = false;
            dynamicChildren = null;
          }
          if (fragmentSlotScopeIds) {
            slotScopeIds = slotScopeIds ? slotScopeIds.concat(fragmentSlotScopeIds) : fragmentSlotScopeIds;
          }
          if (n1 == null) {
            hostInsert(fragmentStartAnchor, container, anchor);
            hostInsert(fragmentEndAnchor, container, anchor);
            mountChildren(
              // #10007
              // such fragment like `<></>` will be compiled into
              // a fragment which doesn't have a children.
              // In this case fallback to an empty array
              n2.children || [],
              container,
              fragmentEndAnchor,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              optimized
            );
          } else {
            if (patchFlag > 0 && patchFlag & 64 && dynamicChildren && // #2715 the previous fragment could've been a BAILed one as a result
            // of renderSlot() with no valid children
            n1.dynamicChildren && n1.dynamicChildren.length === dynamicChildren.length) {
              patchBlockChildren(
                n1.dynamicChildren,
                dynamicChildren,
                container,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds
              );
              {
                traverseStaticChildren(n1, n2);
              }
            } else {
              patchChildren(
                n1,
                n2,
                container,
                fragmentEndAnchor,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
            }
          }
        };
        const processComponent = (n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          n2.slotScopeIds = slotScopeIds;
          if (n1 == null) {
            if (n2.shapeFlag & 512) {
              parentComponent.ctx.activate(
                n2,
                container,
                anchor,
                namespace,
                optimized
              );
            } else {
              mountComponent(
                n2,
                container,
                anchor,
                parentComponent,
                parentSuspense,
                namespace,
                optimized
              );
            }
          } else {
            updateComponent(n1, n2, optimized);
          }
        };
        const mountComponent = (initialVNode, container, anchor, parentComponent, parentSuspense, namespace, optimized) => {
          const instance = initialVNode.component = createComponentInstance(
            initialVNode,
            parentComponent,
            parentSuspense
          );
          if (instance.type.__hmrId) {
            registerHMR(instance);
          }
          {
            pushWarningContext(initialVNode);
            startMeasure(instance, `mount`);
          }
          if (isKeepAlive(initialVNode)) {
            instance.ctx.renderer = internals;
          }
          {
            {
              startMeasure(instance, `init`);
            }
            setupComponent(instance, false, optimized);
            {
              endMeasure(instance, `init`);
            }
          }
          if (isHmrUpdating) initialVNode.el = null;
          if (instance.asyncDep) {
            parentSuspense && parentSuspense.registerDep(instance, setupRenderEffect, optimized);
            if (!initialVNode.el) {
              const placeholder = instance.subTree = createVNode(Comment);
              processCommentNode(null, placeholder, container, anchor);
              initialVNode.placeholder = placeholder.el;
            }
          } else {
            setupRenderEffect(
              instance,
              initialVNode,
              container,
              anchor,
              parentSuspense,
              namespace,
              optimized
            );
          }
          {
            popWarningContext();
            endMeasure(instance, `mount`);
          }
        };
        const updateComponent = (n1, n2, optimized) => {
          const instance = n2.component = n1.component;
          if (shouldUpdateComponent(n1, n2, optimized)) {
            if (instance.asyncDep && !instance.asyncResolved) {
              {
                pushWarningContext(n2);
              }
              updateComponentPreRender(instance, n2, optimized);
              {
                popWarningContext();
              }
              return;
            } else {
              instance.next = n2;
              instance.update();
            }
          } else {
            n2.el = n1.el;
            instance.vnode = n2;
          }
        };
        const setupRenderEffect = (instance, initialVNode, container, anchor, parentSuspense, namespace, optimized) => {
          const componentUpdateFn = () => {
            if (!instance.isMounted) {
              let vnodeHook;
              const { el, props } = initialVNode;
              const { bm, m, parent, root, type } = instance;
              const isAsyncWrapperVNode = isAsyncWrapper(initialVNode);
              toggleRecurse(instance, false);
              if (bm) {
                shared.invokeArrayFns(bm);
              }
              if (!isAsyncWrapperVNode && (vnodeHook = props && props.onVnodeBeforeMount)) {
                invokeVNodeHook(vnodeHook, parent, initialVNode);
              }
              toggleRecurse(instance, true);
              if (el && hydrateNode) {
                const hydrateSubTree = () => {
                  {
                    startMeasure(instance, `render`);
                  }
                  instance.subTree = renderComponentRoot(instance);
                  {
                    endMeasure(instance, `render`);
                  }
                  {
                    startMeasure(instance, `hydrate`);
                  }
                  hydrateNode(
                    el,
                    instance.subTree,
                    instance,
                    parentSuspense,
                    null
                  );
                  {
                    endMeasure(instance, `hydrate`);
                  }
                };
                if (isAsyncWrapperVNode && type.__asyncHydrate) {
                  type.__asyncHydrate(
                    el,
                    instance,
                    hydrateSubTree
                  );
                } else {
                  hydrateSubTree();
                }
              } else {
                if (root.ce && root.ce._hasShadowRoot()) {
                  root.ce._injectChildStyle(
                    type,
                    instance.parent ? instance.parent.type : void 0
                  );
                }
                {
                  startMeasure(instance, `render`);
                }
                const subTree = instance.subTree = renderComponentRoot(instance);
                {
                  endMeasure(instance, `render`);
                }
                {
                  startMeasure(instance, `patch`);
                }
                patch(
                  null,
                  subTree,
                  container,
                  anchor,
                  instance,
                  parentSuspense,
                  namespace
                );
                {
                  endMeasure(instance, `patch`);
                }
                initialVNode.el = subTree.el;
              }
              if (m) {
                queuePostRenderEffect(m, parentSuspense);
              }
              if (!isAsyncWrapperVNode && (vnodeHook = props && props.onVnodeMounted)) {
                const scopedInitialVNode = initialVNode;
                queuePostRenderEffect(
                  () => invokeVNodeHook(vnodeHook, parent, scopedInitialVNode),
                  parentSuspense
                );
              }
              if (initialVNode.shapeFlag & 256 || parent && isAsyncWrapper(parent.vnode) && parent.vnode.shapeFlag & 256) {
                instance.a && queuePostRenderEffect(instance.a, parentSuspense);
              }
              instance.isMounted = true;
              {
                devtoolsComponentAdded(instance);
              }
              initialVNode = container = anchor = null;
            } else {
              let { next, bu, u, parent, vnode } = instance;
              {
                const nonHydratedAsyncRoot = locateNonHydratedAsyncRoot(instance);
                if (nonHydratedAsyncRoot) {
                  if (next) {
                    next.el = vnode.el;
                    updateComponentPreRender(instance, next, optimized);
                  }
                  nonHydratedAsyncRoot.asyncDep.then(() => {
                    queuePostRenderEffect(() => {
                      if (!instance.isUnmounted) update();
                    }, parentSuspense);
                  });
                  return;
                }
              }
              let originNext = next;
              let vnodeHook;
              {
                pushWarningContext(next || instance.vnode);
              }
              toggleRecurse(instance, false);
              if (next) {
                next.el = vnode.el;
                updateComponentPreRender(instance, next, optimized);
              } else {
                next = vnode;
              }
              if (bu) {
                shared.invokeArrayFns(bu);
              }
              if (vnodeHook = next.props && next.props.onVnodeBeforeUpdate) {
                invokeVNodeHook(vnodeHook, parent, next, vnode);
              }
              toggleRecurse(instance, true);
              {
                startMeasure(instance, `render`);
              }
              const nextTree = renderComponentRoot(instance);
              {
                endMeasure(instance, `render`);
              }
              const prevTree = instance.subTree;
              instance.subTree = nextTree;
              {
                startMeasure(instance, `patch`);
              }
              patch(
                prevTree,
                nextTree,
                // parent may have changed if it's in a teleport
                hostParentNode(prevTree.el),
                // anchor may have changed if it's in a fragment
                getNextHostNode(prevTree),
                instance,
                parentSuspense,
                namespace
              );
              {
                endMeasure(instance, `patch`);
              }
              next.el = nextTree.el;
              if (originNext === null) {
                updateHOCHostEl(instance, nextTree.el);
              }
              if (u) {
                queuePostRenderEffect(u, parentSuspense);
              }
              if (vnodeHook = next.props && next.props.onVnodeUpdated) {
                queuePostRenderEffect(
                  () => invokeVNodeHook(vnodeHook, parent, next, vnode),
                  parentSuspense
                );
              }
              {
                devtoolsComponentUpdated(instance);
              }
              {
                popWarningContext();
              }
            }
          };
          instance.scope.on();
          const effect = instance.effect = new reactivity.ReactiveEffect(componentUpdateFn);
          instance.scope.off();
          const update = instance.update = effect.run.bind(effect);
          const job = instance.job = effect.runIfDirty.bind(effect);
          job.i = instance;
          job.id = instance.uid;
          effect.scheduler = () => queueJob(job);
          toggleRecurse(instance, true);
          {
            effect.onTrack = instance.rtc ? (e) => shared.invokeArrayFns(instance.rtc, e) : void 0;
            effect.onTrigger = instance.rtg ? (e) => shared.invokeArrayFns(instance.rtg, e) : void 0;
          }
          update();
        };
        const updateComponentPreRender = (instance, nextVNode, optimized) => {
          nextVNode.component = instance;
          const prevProps = instance.vnode.props;
          instance.vnode = nextVNode;
          instance.next = null;
          updateProps(instance, nextVNode.props, prevProps, optimized);
          updateSlots(instance, nextVNode.children, optimized);
          reactivity.pauseTracking();
          flushPreFlushCbs(instance);
          reactivity.resetTracking();
        };
        const patchChildren = (n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized = false) => {
          const c1 = n1 && n1.children;
          const prevShapeFlag = n1 ? n1.shapeFlag : 0;
          const c2 = n2.children;
          const { patchFlag, shapeFlag } = n2;
          if (patchFlag > 0) {
            if (patchFlag & 128) {
              patchKeyedChildren(
                c1,
                c2,
                container,
                anchor,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
              return;
            } else if (patchFlag & 256) {
              patchUnkeyedChildren(
                c1,
                c2,
                container,
                anchor,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
              return;
            }
          }
          if (shapeFlag & 8) {
            if (prevShapeFlag & 16) {
              unmountChildren(c1, parentComponent, parentSuspense);
            }
            if (c2 !== c1) {
              hostSetElementText(container, c2);
            }
          } else {
            if (prevShapeFlag & 16) {
              if (shapeFlag & 16) {
                patchKeyedChildren(
                  c1,
                  c2,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
              } else {
                unmountChildren(c1, parentComponent, parentSuspense, true);
              }
            } else {
              if (prevShapeFlag & 8) {
                hostSetElementText(container, "");
              }
              if (shapeFlag & 16) {
                mountChildren(
                  c2,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
              }
            }
          }
        };
        const patchUnkeyedChildren = (c1, c2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          c1 = c1 || shared.EMPTY_ARR;
          c2 = c2 || shared.EMPTY_ARR;
          const oldLength = c1.length;
          const newLength = c2.length;
          const commonLength = Math.min(oldLength, newLength);
          let i;
          for (i = 0; i < commonLength; i++) {
            const nextChild = c2[i] = optimized ? cloneIfMounted(c2[i]) : normalizeVNode(c2[i]);
            patch(
              c1[i],
              nextChild,
              container,
              null,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              optimized
            );
          }
          if (oldLength > newLength) {
            unmountChildren(
              c1,
              parentComponent,
              parentSuspense,
              true,
              false,
              commonLength
            );
          } else {
            mountChildren(
              c2,
              container,
              anchor,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              optimized,
              commonLength
            );
          }
        };
        const patchKeyedChildren = (c1, c2, container, parentAnchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
          let i = 0;
          const l2 = c2.length;
          let e1 = c1.length - 1;
          let e2 = l2 - 1;
          while (i <= e1 && i <= e2) {
            const n1 = c1[i];
            const n2 = c2[i] = optimized ? cloneIfMounted(c2[i]) : normalizeVNode(c2[i]);
            if (isSameVNodeType(n1, n2)) {
              patch(
                n1,
                n2,
                container,
                null,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
            } else {
              break;
            }
            i++;
          }
          while (i <= e1 && i <= e2) {
            const n1 = c1[e1];
            const n2 = c2[e2] = optimized ? cloneIfMounted(c2[e2]) : normalizeVNode(c2[e2]);
            if (isSameVNodeType(n1, n2)) {
              patch(
                n1,
                n2,
                container,
                null,
                parentComponent,
                parentSuspense,
                namespace,
                slotScopeIds,
                optimized
              );
            } else {
              break;
            }
            e1--;
            e2--;
          }
          if (i > e1) {
            if (i <= e2) {
              const nextPos = e2 + 1;
              const anchor = nextPos < l2 ? c2[nextPos].el : parentAnchor;
              while (i <= e2) {
                patch(
                  null,
                  c2[i] = optimized ? cloneIfMounted(c2[i]) : normalizeVNode(c2[i]),
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
                i++;
              }
            }
          } else if (i > e2) {
            while (i <= e1) {
              unmount(c1[i], parentComponent, parentSuspense, true);
              i++;
            }
          } else {
            const s1 = i;
            const s2 = i;
            const keyToNewIndexMap = /* @__PURE__ */ new Map();
            for (i = s2; i <= e2; i++) {
              const nextChild = c2[i] = optimized ? cloneIfMounted(c2[i]) : normalizeVNode(c2[i]);
              if (nextChild.key != null) {
                if (keyToNewIndexMap.has(nextChild.key)) {
                  warn$1(
                    `Duplicate keys found during update:`,
                    JSON.stringify(nextChild.key),
                    `Make sure keys are unique.`
                  );
                }
                keyToNewIndexMap.set(nextChild.key, i);
              }
            }
            let j;
            let patched = 0;
            const toBePatched = e2 - s2 + 1;
            let moved = false;
            let maxNewIndexSoFar = 0;
            const newIndexToOldIndexMap = new Array(toBePatched);
            for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0;
            for (i = s1; i <= e1; i++) {
              const prevChild = c1[i];
              if (patched >= toBePatched) {
                unmount(prevChild, parentComponent, parentSuspense, true);
                continue;
              }
              let newIndex;
              if (prevChild.key != null) {
                newIndex = keyToNewIndexMap.get(prevChild.key);
              } else {
                for (j = s2; j <= e2; j++) {
                  if (newIndexToOldIndexMap[j - s2] === 0 && isSameVNodeType(prevChild, c2[j])) {
                    newIndex = j;
                    break;
                  }
                }
              }
              if (newIndex === void 0) {
                unmount(prevChild, parentComponent, parentSuspense, true);
              } else {
                newIndexToOldIndexMap[newIndex - s2] = i + 1;
                if (newIndex >= maxNewIndexSoFar) {
                  maxNewIndexSoFar = newIndex;
                } else {
                  moved = true;
                }
                patch(
                  prevChild,
                  c2[newIndex],
                  container,
                  null,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
                patched++;
              }
            }
            const increasingNewIndexSequence = moved ? getSequence(newIndexToOldIndexMap) : shared.EMPTY_ARR;
            j = increasingNewIndexSequence.length - 1;
            for (i = toBePatched - 1; i >= 0; i--) {
              const nextIndex = s2 + i;
              const nextChild = c2[nextIndex];
              const anchorVNode = c2[nextIndex + 1];
              const anchor = nextIndex + 1 < l2 ? (
                // #13559, #14173 fallback to el placeholder for unresolved async component
                anchorVNode.el || resolveAsyncComponentPlaceholder(anchorVNode)
              ) : parentAnchor;
              if (newIndexToOldIndexMap[i] === 0) {
                patch(
                  null,
                  nextChild,
                  container,
                  anchor,
                  parentComponent,
                  parentSuspense,
                  namespace,
                  slotScopeIds,
                  optimized
                );
              } else if (moved) {
                if (j < 0 || i !== increasingNewIndexSequence[j]) {
                  move(nextChild, container, anchor, 2);
                } else {
                  j--;
                }
              }
            }
          }
        };
        const move = (vnode, container, anchor, moveType, parentSuspense = null) => {
          const { el, type, transition, children, shapeFlag } = vnode;
          if (shapeFlag & 6) {
            move(vnode.component.subTree, container, anchor, moveType);
            return;
          }
          if (shapeFlag & 128) {
            vnode.suspense.move(container, anchor, moveType);
            return;
          }
          if (shapeFlag & 64) {
            type.move(vnode, container, anchor, internals);
            return;
          }
          if (type === Fragment) {
            hostInsert(el, container, anchor);
            for (let i = 0; i < children.length; i++) {
              move(children[i], container, anchor, moveType);
            }
            hostInsert(vnode.anchor, container, anchor);
            return;
          }
          if (type === Static) {
            moveStaticNode(vnode, container, anchor);
            return;
          }
          const needTransition2 = moveType !== 2 && shapeFlag & 1 && transition;
          if (needTransition2) {
            if (moveType === 0) {
              if (transition.persisted && !el[leaveCbKey]) {
                hostInsert(el, container, anchor);
              } else {
                transition.beforeEnter(el);
                hostInsert(el, container, anchor);
                queuePostRenderEffect(() => transition.enter(el), parentSuspense);
              }
            } else {
              const { leave, delayLeave, afterLeave } = transition;
              const remove22 = () => {
                if (vnode.ctx.isUnmounted) {
                  hostRemove(el);
                } else {
                  hostInsert(el, container, anchor);
                }
              };
              const performLeave = () => {
                const wasLeaving = el._isLeaving || !!el[leaveCbKey];
                if (el._isLeaving) {
                  el[leaveCbKey](
                    true
                    /* cancelled */
                  );
                }
                if (transition.persisted && !wasLeaving) {
                  remove22();
                } else {
                  leave(el, () => {
                    remove22();
                    afterLeave && afterLeave();
                  });
                }
              };
              if (delayLeave) {
                delayLeave(el, remove22, performLeave);
              } else {
                performLeave();
              }
            }
          } else {
            hostInsert(el, container, anchor);
          }
        };
        const unmount = (vnode, parentComponent, parentSuspense, doRemove = false, optimized = false) => {
          const {
            type,
            props,
            ref,
            children,
            dynamicChildren,
            shapeFlag,
            patchFlag,
            dirs,
            cacheIndex,
            memo
          } = vnode;
          if (patchFlag === -2) {
            optimized = false;
          }
          if (ref != null) {
            reactivity.pauseTracking();
            setRef(ref, null, parentSuspense, vnode, true);
            reactivity.resetTracking();
          }
          if (cacheIndex != null) {
            parentComponent.renderCache[cacheIndex] = void 0;
          }
          if (shapeFlag & 256) {
            parentComponent.ctx.deactivate(vnode);
            return;
          }
          const shouldInvokeDirs = shapeFlag & 1 && dirs;
          const shouldInvokeVnodeHook = !isAsyncWrapper(vnode);
          let vnodeHook;
          if (shouldInvokeVnodeHook && (vnodeHook = props && props.onVnodeBeforeUnmount)) {
            invokeVNodeHook(vnodeHook, parentComponent, vnode);
          }
          if (shapeFlag & 6) {
            unmountComponent(vnode.component, parentSuspense, doRemove);
          } else {
            if (shapeFlag & 128) {
              vnode.suspense.unmount(parentSuspense, doRemove);
              return;
            }
            if (shouldInvokeDirs) {
              invokeDirectiveHook(vnode, null, parentComponent, "beforeUnmount");
            }
            if (shapeFlag & 64) {
              vnode.type.remove(
                vnode,
                parentComponent,
                parentSuspense,
                internals,
                doRemove
              );
            } else if (dynamicChildren && // #5154
            // when v-once is used inside a block, setBlockTracking(-1) marks the
            // parent block with hasOnce: true
            // so that it doesn't take the fast path during unmount - otherwise
            // components nested in v-once are never unmounted.
            !dynamicChildren.hasOnce && // #1153: fast path should not be taken for non-stable (v-for) fragments
            (type !== Fragment || patchFlag > 0 && patchFlag & 64)) {
              unmountChildren(
                dynamicChildren,
                parentComponent,
                parentSuspense,
                false,
                true
              );
            } else if (type === Fragment && patchFlag & (128 | 256) || !optimized && shapeFlag & 16) {
              unmountChildren(children, parentComponent, parentSuspense);
            }
            if (doRemove) {
              remove2(vnode);
            }
          }
          const shouldInvalidateMemo = memo != null && cacheIndex == null;
          if (shouldInvokeVnodeHook && (vnodeHook = props && props.onVnodeUnmounted) || shouldInvokeDirs || shouldInvalidateMemo) {
            queuePostRenderEffect(() => {
              vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode);
              shouldInvokeDirs && invokeDirectiveHook(vnode, null, parentComponent, "unmounted");
              if (shouldInvalidateMemo) {
                vnode.el = null;
              }
            }, parentSuspense);
          }
        };
        const remove2 = (vnode) => {
          const { type, el, anchor, transition } = vnode;
          if (type === Fragment) {
            if (vnode.patchFlag > 0 && vnode.patchFlag & 2048 && transition && !transition.persisted) {
              vnode.children.forEach((child) => {
                if (child.type === Comment) {
                  hostRemove(child.el);
                } else {
                  remove2(child);
                }
              });
            } else {
              removeFragment(el, anchor);
            }
            return;
          }
          if (type === Static) {
            removeStaticNode(vnode);
            return;
          }
          const performRemove = () => {
            hostRemove(el);
            if (transition && !transition.persisted && transition.afterLeave) {
              transition.afterLeave();
            }
          };
          if (vnode.shapeFlag & 1 && transition && !transition.persisted) {
            const { leave, delayLeave } = transition;
            const performLeave = () => leave(el, performRemove);
            if (delayLeave) {
              delayLeave(vnode.el, performRemove, performLeave);
            } else {
              performLeave();
            }
          } else {
            performRemove();
          }
        };
        const removeFragment = (cur, end) => {
          let next;
          while (cur !== end) {
            next = hostNextSibling(cur);
            hostRemove(cur);
            cur = next;
          }
          hostRemove(end);
        };
        const unmountComponent = (instance, parentSuspense, doRemove) => {
          if (instance.type.__hmrId) {
            unregisterHMR(instance);
          }
          const { bum, scope, job, subTree, um, m, a } = instance;
          invalidateMount(m);
          invalidateMount(a);
          if (bum) {
            shared.invokeArrayFns(bum);
          }
          scope.stop();
          if (job) {
            job.flags |= 8;
            unmount(subTree, instance, parentSuspense, doRemove);
          }
          if (um) {
            queuePostRenderEffect(um, parentSuspense);
          }
          queuePostRenderEffect(() => {
            instance.isUnmounted = true;
          }, parentSuspense);
          {
            devtoolsComponentRemoved(instance);
          }
        };
        const unmountChildren = (children, parentComponent, parentSuspense, doRemove = false, optimized = false, start = 0) => {
          for (let i = start; i < children.length; i++) {
            unmount(children[i], parentComponent, parentSuspense, doRemove, optimized);
          }
        };
        const getNextHostNode = (vnode) => {
          if (vnode.shapeFlag & 6) {
            return getNextHostNode(vnode.component.subTree);
          }
          if (vnode.shapeFlag & 128) {
            return vnode.suspense.next();
          }
          const el = hostNextSibling(vnode.anchor || vnode.el);
          const teleportEnd = el && el[TeleportEndKey];
          return teleportEnd ? hostNextSibling(teleportEnd) : el;
        };
        let isFlushing = false;
        const render2 = (vnode, container, namespace) => {
          let instance;
          if (vnode == null) {
            if (container._vnode) {
              unmount(container._vnode, null, null, true);
              instance = container._vnode.component;
            }
          } else {
            patch(
              container._vnode || null,
              vnode,
              container,
              null,
              null,
              null,
              namespace
            );
          }
          container._vnode = vnode;
          if (!isFlushing) {
            isFlushing = true;
            flushPreFlushCbs(instance);
            flushPostFlushCbs();
            isFlushing = false;
          }
        };
        const internals = {
          p: patch,
          um: unmount,
          m: move,
          r: remove2,
          mt: mountComponent,
          mc: mountChildren,
          pc: patchChildren,
          pbc: patchBlockChildren,
          n: getNextHostNode,
          o: options
        };
        let hydrate;
        let hydrateNode;
        if (createHydrationFns) {
          [hydrate, hydrateNode] = createHydrationFns(
            internals
          );
        }
        return {
          render: render2,
          hydrate,
          createApp: createAppAPI(render2, hydrate)
        };
      }
      function resolveChildrenNamespace({ type, props }, currentNamespace) {
        return currentNamespace === "svg" && type === "foreignObject" || currentNamespace === "mathml" && type === "annotation-xml" && props && props.encoding && props.encoding.includes("html") ? void 0 : currentNamespace;
      }
      function toggleRecurse({ effect, job }, allowed) {
        if (allowed) {
          effect.flags |= 32;
          job.flags |= 4;
        } else {
          effect.flags &= -33;
          job.flags &= -5;
        }
      }
      function needTransition(parentSuspense, transition) {
        return (!parentSuspense || parentSuspense && !parentSuspense.pendingBranch) && transition && !transition.persisted;
      }
      function traverseStaticChildren(n1, n2, shallow = false) {
        const ch1 = n1.children;
        const ch2 = n2.children;
        if (shared.isArray(ch1) && shared.isArray(ch2)) {
          for (let i = 0; i < ch1.length; i++) {
            const c1 = ch1[i];
            let c2 = ch2[i];
            if (c2.shapeFlag & 1 && !c2.dynamicChildren) {
              if (c2.patchFlag <= 0 || c2.patchFlag === 32) {
                c2 = ch2[i] = cloneIfMounted(ch2[i]);
                c2.el = c1.el;
              }
              if (!shallow && c2.patchFlag !== -2)
                traverseStaticChildren(c1, c2);
            }
            if (c2.type === Text) {
              if (c2.patchFlag === -1) {
                c2 = ch2[i] = cloneIfMounted(c2);
              }
              c2.el = c1.el;
            }
            if (c2.type === Comment && !c2.el) {
              c2.el = c1.el;
            }
            {
              c2.el && (c2.el.__vnode = c2);
            }
          }
        }
      }
      function getSequence(arr) {
        const p = arr.slice();
        const result = [0];
        let i, j, u, v, c;
        const len = arr.length;
        for (i = 0; i < len; i++) {
          const arrI = arr[i];
          if (arrI !== 0) {
            j = result[result.length - 1];
            if (arr[j] < arrI) {
              p[i] = j;
              result.push(i);
              continue;
            }
            u = 0;
            v = result.length - 1;
            while (u < v) {
              c = u + v >> 1;
              if (arr[result[c]] < arrI) {
                u = c + 1;
              } else {
                v = c;
              }
            }
            if (arrI < arr[result[u]]) {
              if (u > 0) {
                p[i] = result[u - 1];
              }
              result[u] = i;
            }
          }
        }
        u = result.length;
        v = result[u - 1];
        while (u-- > 0) {
          result[u] = v;
          v = p[v];
        }
        return result;
      }
      function locateNonHydratedAsyncRoot(instance) {
        const subComponent = instance.subTree.component;
        if (subComponent) {
          if (subComponent.asyncDep && !subComponent.asyncResolved) {
            return subComponent;
          } else {
            return locateNonHydratedAsyncRoot(subComponent);
          }
        }
      }
      function invalidateMount(hooks) {
        if (hooks) {
          for (let i = 0; i < hooks.length; i++)
            hooks[i].flags |= 8;
        }
      }
      function resolveAsyncComponentPlaceholder(anchorVnode) {
        if (anchorVnode.placeholder) {
          return anchorVnode.placeholder;
        }
        const instance = anchorVnode.component;
        if (instance) {
          return resolveAsyncComponentPlaceholder(instance.subTree);
        }
        return null;
      }
      var isSuspense = (type) => type.__isSuspense;
      var suspenseId = 0;
      var SuspenseImpl = {
        name: "Suspense",
        // In order to make Suspense tree-shakable, we need to avoid importing it
        // directly in the renderer. The renderer checks for the __isSuspense flag
        // on a vnode's type and calls the `process` method, passing in renderer
        // internals.
        __isSuspense: true,
        process(n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized, rendererInternals) {
          if (n1 == null) {
            mountSuspense(
              n2,
              container,
              anchor,
              parentComponent,
              parentSuspense,
              namespace,
              slotScopeIds,
              optimized,
              rendererInternals
            );
          } else {
            if (parentSuspense && parentSuspense.deps > 0 && !n1.suspense.isInFallback) {
              n2.suspense = n1.suspense;
              n2.suspense.vnode = n2;
              n2.el = n1.el;
              return;
            }
            patchSuspense(
              n1,
              n2,
              container,
              anchor,
              parentComponent,
              namespace,
              slotScopeIds,
              optimized,
              rendererInternals
            );
          }
        },
        hydrate: hydrateSuspense,
        normalize: normalizeSuspenseChildren
      };
      var Suspense = SuspenseImpl;
      function triggerEvent(vnode, name) {
        const eventListener = vnode.props && vnode.props[name];
        if (shared.isFunction(eventListener)) {
          eventListener();
        }
      }
      function mountSuspense(vnode, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized, rendererInternals) {
        const {
          p: patch,
          o: { createElement }
        } = rendererInternals;
        const hiddenContainer = createElement("div");
        const suspense = vnode.suspense = createSuspenseBoundary(
          vnode,
          parentSuspense,
          parentComponent,
          container,
          hiddenContainer,
          anchor,
          namespace,
          slotScopeIds,
          optimized,
          rendererInternals
        );
        patch(
          null,
          suspense.pendingBranch = vnode.ssContent,
          hiddenContainer,
          null,
          parentComponent,
          suspense,
          namespace,
          slotScopeIds
        );
        if (suspense.deps > 0) {
          triggerEvent(vnode, "onPending");
          triggerEvent(vnode, "onFallback");
          patch(
            null,
            vnode.ssFallback,
            container,
            anchor,
            parentComponent,
            null,
            // fallback tree will not have suspense context
            namespace,
            slotScopeIds
          );
          setActiveBranch(suspense, vnode.ssFallback);
        } else {
          suspense.resolve(false, true);
        }
      }
      function patchSuspense(n1, n2, container, anchor, parentComponent, namespace, slotScopeIds, optimized, { p: patch, um: unmount, o: { createElement } }) {
        const suspense = n2.suspense = n1.suspense;
        suspense.vnode = n2;
        n2.el = n1.el;
        const newBranch = n2.ssContent;
        const newFallback = n2.ssFallback;
        const { activeBranch, pendingBranch, isInFallback, isHydrating } = suspense;
        if (pendingBranch) {
          suspense.pendingBranch = newBranch;
          if (isSameVNodeType(pendingBranch, newBranch)) {
            patch(
              pendingBranch,
              newBranch,
              suspense.hiddenContainer,
              null,
              parentComponent,
              suspense,
              namespace,
              slotScopeIds,
              optimized
            );
            if (suspense.deps <= 0) {
              suspense.resolve();
            } else if (isInFallback) {
              if (!isHydrating && !suspense.isFallbackMountPending) {
                patch(
                  activeBranch,
                  newFallback,
                  container,
                  anchor,
                  parentComponent,
                  null,
                  // fallback tree will not have suspense context
                  namespace,
                  slotScopeIds,
                  optimized
                );
                setActiveBranch(suspense, newFallback);
              }
            }
          } else {
            suspense.pendingId = suspenseId++;
            if (isHydrating) {
              suspense.isHydrating = false;
              suspense.activeBranch = pendingBranch;
            } else {
              unmount(pendingBranch, parentComponent, suspense);
            }
            suspense.deps = 0;
            suspense.effects.length = 0;
            suspense.hiddenContainer = createElement("div");
            if (isInFallback) {
              patch(
                null,
                newBranch,
                suspense.hiddenContainer,
                null,
                parentComponent,
                suspense,
                namespace,
                slotScopeIds,
                optimized
              );
              if (suspense.deps <= 0) {
                suspense.resolve();
              } else if (!suspense.isFallbackMountPending) {
                patch(
                  activeBranch,
                  newFallback,
                  container,
                  anchor,
                  parentComponent,
                  null,
                  // fallback tree will not have suspense context
                  namespace,
                  slotScopeIds,
                  optimized
                );
                setActiveBranch(suspense, newFallback);
              }
            } else if (activeBranch && isSameVNodeType(activeBranch, newBranch)) {
              patch(
                activeBranch,
                newBranch,
                container,
                anchor,
                parentComponent,
                suspense,
                namespace,
                slotScopeIds,
                optimized
              );
              suspense.resolve(true);
            } else {
              patch(
                null,
                newBranch,
                suspense.hiddenContainer,
                null,
                parentComponent,
                suspense,
                namespace,
                slotScopeIds,
                optimized
              );
              if (suspense.deps <= 0) {
                suspense.resolve();
              }
            }
          }
        } else {
          if (activeBranch && isSameVNodeType(activeBranch, newBranch)) {
            patch(
              activeBranch,
              newBranch,
              container,
              anchor,
              parentComponent,
              suspense,
              namespace,
              slotScopeIds,
              optimized
            );
            setActiveBranch(suspense, newBranch);
          } else {
            triggerEvent(n2, "onPending");
            suspense.pendingBranch = newBranch;
            if (newBranch.shapeFlag & 512) {
              suspense.pendingId = newBranch.component.suspenseId;
            } else {
              suspense.pendingId = suspenseId++;
            }
            patch(
              null,
              newBranch,
              suspense.hiddenContainer,
              null,
              parentComponent,
              suspense,
              namespace,
              slotScopeIds,
              optimized
            );
            if (suspense.deps <= 0) {
              suspense.resolve();
            } else {
              const { timeout, pendingId } = suspense;
              if (timeout > 0) {
                setTimeout(() => {
                  if (suspense.pendingId === pendingId) {
                    suspense.fallback(newFallback);
                  }
                }, timeout);
              } else if (timeout === 0) {
                suspense.fallback(newFallback);
              }
            }
          }
        }
      }
      var hasWarned = false;
      function createSuspenseBoundary(vnode, parentSuspense, parentComponent, container, hiddenContainer, anchor, namespace, slotScopeIds, optimized, rendererInternals, isHydrating = false) {
        if (!hasWarned) {
          hasWarned = true;
          console[console.info ? "info" : "log"](
            `<Suspense> is an experimental feature and its API will likely change.`
          );
        }
        const {
          p: patch,
          m: move,
          um: unmount,
          n: next,
          o: { parentNode, remove: remove2 }
        } = rendererInternals;
        let parentSuspenseId;
        const isSuspensible = isVNodeSuspensible(vnode);
        if (isSuspensible) {
          if (parentSuspense && parentSuspense.pendingBranch) {
            parentSuspenseId = parentSuspense.pendingId;
            parentSuspense.deps++;
          }
        }
        const timeout = vnode.props ? shared.toNumber(vnode.props.timeout) : void 0;
        {
          assertNumber(timeout, `Suspense timeout`);
        }
        const initialAnchor = anchor;
        const suspense = {
          vnode,
          parent: parentSuspense,
          parentComponent,
          namespace,
          container,
          hiddenContainer,
          deps: 0,
          pendingId: suspenseId++,
          timeout: typeof timeout === "number" ? timeout : -1,
          activeBranch: null,
          isFallbackMountPending: false,
          pendingBranch: null,
          isInFallback: !isHydrating,
          isHydrating,
          isUnmounted: false,
          effects: [],
          resolve(resume = false, sync = false) {
            {
              if (!resume && !suspense.pendingBranch) {
                throw new Error(
                  `suspense.resolve() is called without a pending branch.`
                );
              }
              if (suspense.isUnmounted) {
                throw new Error(
                  `suspense.resolve() is called on an already unmounted suspense boundary.`
                );
              }
            }
            const {
              vnode: vnode2,
              activeBranch,
              pendingBranch,
              pendingId,
              effects,
              parentComponent: parentComponent2,
              container: container2,
              isInFallback
            } = suspense;
            let delayEnter = false;
            if (suspense.isHydrating) {
              suspense.isHydrating = false;
            } else if (!resume) {
              delayEnter = activeBranch && pendingBranch.transition && pendingBranch.transition.mode === "out-in";
              let hasUpdatedAnchor = false;
              if (delayEnter) {
                activeBranch.transition.afterLeave = () => {
                  if (pendingId === suspense.pendingId) {
                    move(
                      pendingBranch,
                      container2,
                      anchor === initialAnchor && !hasUpdatedAnchor ? next(activeBranch) : anchor,
                      0
                    );
                    queuePostFlushCb(effects);
                    if (isInFallback && vnode2.ssFallback) {
                      vnode2.ssFallback.el = null;
                    }
                  }
                };
              }
              if (activeBranch && !suspense.isFallbackMountPending) {
                if (parentNode(activeBranch.el) === container2) {
                  anchor = next(activeBranch);
                  hasUpdatedAnchor = true;
                }
                unmount(activeBranch, parentComponent2, suspense, true);
                if (!delayEnter && isInFallback && vnode2.ssFallback) {
                  queuePostRenderEffect(() => vnode2.ssFallback.el = null, suspense);
                }
              }
              if (!delayEnter) {
                move(pendingBranch, container2, anchor, 0);
              }
            }
            suspense.isFallbackMountPending = false;
            setActiveBranch(suspense, pendingBranch);
            suspense.pendingBranch = null;
            suspense.isInFallback = false;
            let parent = suspense.parent;
            let hasUnresolvedAncestor = false;
            while (parent) {
              if (parent.pendingBranch) {
                for (let i = 0; i < effects.length; i++) {
                  parent.effects.push(effects[i]);
                }
                hasUnresolvedAncestor = true;
                break;
              }
              parent = parent.parent;
            }
            if (!hasUnresolvedAncestor && !delayEnter) {
              queuePostFlushCb(effects);
            }
            suspense.effects = [];
            if (isSuspensible) {
              if (parentSuspense && parentSuspense.pendingBranch && parentSuspenseId === parentSuspense.pendingId) {
                parentSuspense.deps--;
                if (parentSuspense.deps === 0 && !sync) {
                  parentSuspense.resolve();
                }
              }
            }
            triggerEvent(vnode2, "onResolve");
          },
          fallback(fallbackVNode) {
            if (!suspense.pendingBranch) {
              return;
            }
            const { vnode: vnode2, activeBranch, parentComponent: parentComponent2, container: container2, namespace: namespace2 } = suspense;
            triggerEvent(vnode2, "onFallback");
            const anchor2 = next(activeBranch);
            const mountFallback = () => {
              suspense.isFallbackMountPending = false;
              if (!suspense.isInFallback) {
                return;
              }
              const latestFallback = suspense.vnode.ssFallback;
              patch(
                null,
                latestFallback,
                container2,
                anchor2,
                parentComponent2,
                null,
                // fallback tree will not have suspense context
                namespace2,
                slotScopeIds,
                optimized
              );
              setActiveBranch(suspense, latestFallback);
            };
            const delayEnter = fallbackVNode.transition && fallbackVNode.transition.mode === "out-in";
            if (delayEnter) {
              suspense.isFallbackMountPending = true;
              activeBranch.transition.afterLeave = mountFallback;
            }
            suspense.isInFallback = true;
            unmount(
              activeBranch,
              parentComponent2,
              null,
              // no suspense so unmount hooks fire now
              true
              // shouldRemove
            );
            if (!delayEnter) {
              mountFallback();
            }
          },
          move(container2, anchor2, type) {
            suspense.activeBranch && move(suspense.activeBranch, container2, anchor2, type);
            suspense.container = container2;
          },
          next() {
            return suspense.activeBranch && next(suspense.activeBranch);
          },
          registerDep(instance, setupRenderEffect, optimized2) {
            const isInPendingSuspense = !!suspense.pendingBranch;
            if (isInPendingSuspense) {
              suspense.deps++;
            }
            const hydratedEl = instance.vnode.el;
            instance.asyncDep.catch((err) => {
              handleError(err, instance, 0);
            }).then((asyncSetupResult) => {
              if (instance.isUnmounted || suspense.isUnmounted || suspense.pendingId !== instance.suspenseId) {
                return;
              }
              unsetCurrentInstance();
              instance.asyncResolved = true;
              const { vnode: vnode2 } = instance;
              {
                pushWarningContext(vnode2);
              }
              handleSetupResult(instance, asyncSetupResult, false);
              if (hydratedEl) {
                vnode2.el = hydratedEl;
              }
              const placeholder = !hydratedEl && instance.subTree.el;
              setupRenderEffect(
                instance,
                vnode2,
                // component may have been moved before resolve.
                // if this is not a hydration, instance.subTree will be the comment
                // placeholder.
                parentNode(hydratedEl || instance.subTree.el),
                // anchor will not be used if this is hydration, so only need to
                // consider the comment placeholder case.
                hydratedEl ? null : next(instance.subTree),
                suspense,
                namespace,
                optimized2
              );
              if (placeholder) {
                vnode2.placeholder = null;
                remove2(placeholder);
              }
              updateHOCHostEl(instance, vnode2.el);
              {
                popWarningContext();
              }
              if (isInPendingSuspense && --suspense.deps === 0) {
                suspense.resolve();
              }
            });
          },
          unmount(parentSuspense2, doRemove) {
            suspense.isUnmounted = true;
            if (suspense.activeBranch) {
              unmount(
                suspense.activeBranch,
                parentComponent,
                parentSuspense2,
                doRemove
              );
            }
            if (suspense.pendingBranch) {
              unmount(
                suspense.pendingBranch,
                parentComponent,
                parentSuspense2,
                doRemove
              );
            }
          }
        };
        return suspense;
      }
      function hydrateSuspense(node, vnode, parentComponent, parentSuspense, namespace, slotScopeIds, optimized, rendererInternals, hydrateNode) {
        const suspense = vnode.suspense = createSuspenseBoundary(
          vnode,
          parentSuspense,
          parentComponent,
          node.parentNode,
          // eslint-disable-next-line no-restricted-globals
          document.createElement("div"),
          null,
          namespace,
          slotScopeIds,
          optimized,
          rendererInternals,
          true
        );
        const result = hydrateNode(
          node,
          suspense.pendingBranch = vnode.ssContent,
          parentComponent,
          suspense,
          slotScopeIds,
          optimized
        );
        if (suspense.deps === 0) {
          suspense.resolve(false, true);
        }
        return result;
      }
      function normalizeSuspenseChildren(vnode) {
        const { shapeFlag, children } = vnode;
        const isSlotChildren = shapeFlag & 32;
        vnode.ssContent = normalizeSuspenseSlot(
          isSlotChildren ? children.default : children
        );
        vnode.ssFallback = isSlotChildren ? normalizeSuspenseSlot(children.fallback) : createVNode(Comment);
      }
      function normalizeSuspenseSlot(s) {
        let block;
        if (shared.isFunction(s)) {
          const trackBlock = isBlockTreeEnabled && s._c;
          if (trackBlock) {
            s._d = false;
            openBlock();
          }
          s = s();
          if (trackBlock) {
            s._d = true;
            block = currentBlock;
            closeBlock();
          }
        }
        if (shared.isArray(s)) {
          const singleChild = filterSingleRoot(s);
          if (!singleChild && s.filter((child) => child !== NULL_DYNAMIC_COMPONENT).length > 0) {
            warn$1(`<Suspense> slots expect a single root node.`);
          }
          s = singleChild;
        }
        s = normalizeVNode(s);
        if (block && !s.dynamicChildren) {
          s.dynamicChildren = block.filter((c) => c !== s);
        }
        return s;
      }
      function queueEffectWithSuspense(fn, suspense) {
        if (suspense && suspense.pendingBranch) {
          if (shared.isArray(fn)) {
            suspense.effects.push(...fn);
          } else {
            suspense.effects.push(fn);
          }
        } else {
          queuePostFlushCb(fn);
        }
      }
      function setActiveBranch(suspense, branch) {
        suspense.activeBranch = branch;
        const { vnode, parentComponent } = suspense;
        let el = branch.el;
        while (!el && branch.component) {
          branch = branch.component.subTree;
          el = branch.el;
        }
        vnode.el = el;
        if (parentComponent && parentComponent.subTree === vnode) {
          parentComponent.vnode.el = el;
          updateHOCHostEl(parentComponent, el);
        }
      }
      function isVNodeSuspensible(vnode) {
        const suspensible = vnode.props && vnode.props.suspensible;
        return suspensible != null && suspensible !== false;
      }
      var Fragment = /* @__PURE__ */ Symbol.for("v-fgt");
      var Text = /* @__PURE__ */ Symbol.for("v-txt");
      var Comment = /* @__PURE__ */ Symbol.for("v-cmt");
      var Static = /* @__PURE__ */ Symbol.for("v-stc");
      var blockStack = [];
      var currentBlock = null;
      function openBlock(disableTracking = false) {
        blockStack.push(currentBlock = disableTracking ? null : []);
      }
      function closeBlock() {
        blockStack.pop();
        currentBlock = blockStack[blockStack.length - 1] || null;
      }
      var isBlockTreeEnabled = 1;
      function setBlockTracking(value, inVOnce = false) {
        isBlockTreeEnabled += value;
        if (value < 0 && currentBlock && inVOnce) {
          currentBlock.hasOnce = true;
        }
      }
      function setupBlock(vnode) {
        vnode.dynamicChildren = isBlockTreeEnabled > 0 ? currentBlock || shared.EMPTY_ARR : null;
        closeBlock();
        if (isBlockTreeEnabled > 0 && currentBlock) {
          currentBlock.push(vnode);
        }
        return vnode;
      }
      function createElementBlock(type, props, children, patchFlag, dynamicProps, shapeFlag) {
        return setupBlock(
          createBaseVNode(
            type,
            props,
            children,
            patchFlag,
            dynamicProps,
            shapeFlag,
            true
          )
        );
      }
      function createBlock(type, props, children, patchFlag, dynamicProps) {
        return setupBlock(
          createVNode(
            type,
            props,
            children,
            patchFlag,
            dynamicProps,
            true
          )
        );
      }
      function isVNode(value) {
        return value ? value.__v_isVNode === true : false;
      }
      function isSameVNodeType(n1, n2) {
        if (n2.shapeFlag & 6 && n1.component) {
          const dirtyInstances = hmrDirtyComponents.get(n2.type);
          if (dirtyInstances && dirtyInstances.has(n1.component)) {
            n1.shapeFlag &= -257;
            n2.shapeFlag &= -513;
            return false;
          }
        }
        return n1.type === n2.type && n1.key === n2.key;
      }
      var vnodeArgsTransformer;
      function transformVNodeArgs(transformer) {
        vnodeArgsTransformer = transformer;
      }
      var createVNodeWithArgsTransform = (...args) => {
        return _createVNode(
          ...vnodeArgsTransformer ? vnodeArgsTransformer(args, currentRenderingInstance) : args
        );
      };
      var normalizeKey = ({ key }) => key != null ? key : null;
      var normalizeRef = ({
        ref,
        ref_key,
        ref_for
      }) => {
        if (typeof ref === "number") {
          ref = "" + ref;
        }
        return ref != null ? shared.isString(ref) || reactivity.isRef(ref) || shared.isFunction(ref) ? { i: currentRenderingInstance, r: ref, k: ref_key, f: !!ref_for } : ref : null;
      };
      function createBaseVNode(type, props = null, children = null, patchFlag = 0, dynamicProps = null, shapeFlag = type === Fragment ? 0 : 1, isBlockNode = false, needFullChildrenNormalization = false) {
        const vnode = {
          __v_isVNode: true,
          __v_skip: true,
          type,
          props,
          key: props && normalizeKey(props),
          ref: props && normalizeRef(props),
          scopeId: currentScopeId,
          slotScopeIds: null,
          children,
          component: null,
          suspense: null,
          ssContent: null,
          ssFallback: null,
          dirs: null,
          transition: null,
          el: null,
          anchor: null,
          target: null,
          targetStart: null,
          targetAnchor: null,
          staticCount: 0,
          shapeFlag,
          patchFlag,
          dynamicProps,
          dynamicChildren: null,
          appContext: null,
          ctx: currentRenderingInstance
        };
        if (needFullChildrenNormalization) {
          normalizeChildren(vnode, children);
          if (shapeFlag & 128) {
            type.normalize(vnode);
          }
        } else if (children) {
          vnode.shapeFlag |= shared.isString(children) ? 8 : 16;
        }
        if (vnode.key !== vnode.key) {
          warn$1(`VNode created with invalid key (NaN). VNode type:`, vnode.type);
        }
        if (props && vnode.shapeFlag & 1) {
          const overwritingProp = props.innerHTML != null ? "innerHTML" : props.textContent != null ? "textContent" : null;
          if (overwritingProp && hasContentChildren(vnode.children)) {
            warn$1(
              `The \`${overwritingProp}\` prop on <${vnode.type}> will override its children. Remove either the \`${overwritingProp}\` prop or the children.`
            );
          }
        }
        if (isBlockTreeEnabled > 0 && // avoid a block node from tracking itself
        !isBlockNode && // has current parent block
        currentBlock && // presence of a patch flag indicates this node needs patching on updates.
        // component nodes also should always be patched, because even if the
        // component doesn't need to update, it needs to persist the instance on to
        // the next vnode so that it can be properly unmounted later.
        (vnode.patchFlag > 0 || shapeFlag & 6) && // the EVENTS flag is only for hydration and if it is the only flag, the
        // vnode should not be considered dynamic due to handler caching.
        vnode.patchFlag !== 32) {
          currentBlock.push(vnode);
        }
        return vnode;
      }
      function hasContentChildren(children) {
        if (shared.isString(children)) return children !== "";
        if (shared.isArray(children)) return children.length > 0;
        return false;
      }
      var createVNode = createVNodeWithArgsTransform;
      function _createVNode(type, props = null, children = null, patchFlag = 0, dynamicProps = null, isBlockNode = false) {
        if (!type || type === NULL_DYNAMIC_COMPONENT) {
          if (!type) {
            warn$1(`Invalid vnode type when creating vnode: ${type}.`);
          }
          type = Comment;
        }
        if (isVNode(type)) {
          const cloned = cloneVNode(
            type,
            props,
            true
            /* mergeRef: true */
          );
          if (children) {
            normalizeChildren(cloned, children);
          }
          if (isBlockTreeEnabled > 0 && !isBlockNode && currentBlock) {
            if (cloned.shapeFlag & 6) {
              currentBlock[currentBlock.indexOf(type)] = cloned;
            } else {
              currentBlock.push(cloned);
            }
          }
          cloned.patchFlag = -2;
          return cloned;
        }
        if (isClassComponent(type)) {
          type = type.__vccOpts;
        }
        if (props) {
          props = guardReactiveProps(props);
          let { class: klass, style } = props;
          if (klass && !shared.isString(klass)) {
            props.class = shared.normalizeClass(klass);
          }
          if (shared.isObject(style)) {
            if (reactivity.isProxy(style) && !shared.isArray(style)) {
              style = shared.extend({}, style);
            }
            props.style = shared.normalizeStyle(style);
          }
        }
        const shapeFlag = shared.isString(type) ? 1 : isSuspense(type) ? 128 : isTeleport(type) ? 64 : shared.isObject(type) ? 4 : shared.isFunction(type) ? 2 : 0;
        if (shapeFlag & 4 && reactivity.isProxy(type)) {
          type = reactivity.toRaw(type);
          warn$1(
            `Vue received a Component that was made a reactive object. This can lead to unnecessary performance overhead and should be avoided by marking the component with \`markRaw\` or using \`shallowRef\` instead of \`ref\`.`,
            `
Component that was made reactive: `,
            type
          );
        }
        return createBaseVNode(
          type,
          props,
          children,
          patchFlag,
          dynamicProps,
          shapeFlag,
          isBlockNode,
          true
        );
      }
      function guardReactiveProps(props) {
        if (!props) return null;
        return reactivity.isProxy(props) || isInternalObject(props) ? shared.extend({}, props) : props;
      }
      function cloneVNode(vnode, extraProps, mergeRef = false, cloneTransition = false) {
        const { props, ref, patchFlag, children, transition } = vnode;
        const mergedProps = extraProps ? mergeProps(props || {}, extraProps) : props;
        const cloned = {
          __v_isVNode: true,
          __v_skip: true,
          type: vnode.type,
          props: mergedProps,
          key: mergedProps && normalizeKey(mergedProps),
          ref: extraProps && extraProps.ref ? (
            // #2078 in the case of <component :is="vnode" ref="extra"/>
            // if the vnode itself already has a ref, cloneVNode will need to merge
            // the refs so the single vnode can be set on multiple refs
            mergeRef && ref ? shared.isArray(ref) ? ref.concat(normalizeRef(extraProps)) : [ref, normalizeRef(extraProps)] : normalizeRef(extraProps)
          ) : ref,
          scopeId: vnode.scopeId,
          slotScopeIds: vnode.slotScopeIds,
          children: patchFlag === -1 && shared.isArray(children) ? children.map(deepCloneVNode) : children,
          target: vnode.target,
          targetStart: vnode.targetStart,
          targetAnchor: vnode.targetAnchor,
          staticCount: vnode.staticCount,
          shapeFlag: vnode.shapeFlag,
          // if the vnode is cloned with extra props, we can no longer assume its
          // existing patch flag to be reliable and need to add the FULL_PROPS flag.
          // note: preserve flag for fragments since they use the flag for children
          // fast paths only.
          patchFlag: extraProps && vnode.type !== Fragment ? patchFlag === -1 ? 16 : patchFlag | 16 : patchFlag,
          dynamicProps: vnode.dynamicProps,
          dynamicChildren: vnode.dynamicChildren,
          appContext: vnode.appContext,
          dirs: vnode.dirs,
          transition,
          // These should technically only be non-null on mounted VNodes. However,
          // they *should* be copied for kept-alive vnodes. So we just always copy
          // them since them being non-null during a mount doesn't affect the logic as
          // they will simply be overwritten.
          component: vnode.component,
          suspense: vnode.suspense,
          ssContent: vnode.ssContent && cloneVNode(vnode.ssContent),
          ssFallback: vnode.ssFallback && cloneVNode(vnode.ssFallback),
          placeholder: vnode.placeholder,
          el: vnode.el,
          anchor: vnode.anchor,
          ctx: vnode.ctx,
          ce: vnode.ce
        };
        if (transition && cloneTransition) {
          setTransitionHooks(
            cloned,
            transition.clone(cloned)
          );
        }
        return cloned;
      }
      function deepCloneVNode(vnode) {
        const cloned = cloneVNode(vnode);
        if (shared.isArray(vnode.children)) {
          cloned.children = vnode.children.map(deepCloneVNode);
        }
        return cloned;
      }
      function createTextVNode(text = " ", flag = 0) {
        return createVNode(Text, null, text, flag);
      }
      function createStaticVNode(content, numberOfNodes) {
        const vnode = createVNode(Static, null, content);
        vnode.staticCount = numberOfNodes;
        return vnode;
      }
      function createCommentVNode(text = "", asBlock = false) {
        return asBlock ? (openBlock(), createBlock(Comment, null, text)) : createVNode(Comment, null, text);
      }
      function normalizeVNode(child) {
        if (child == null || typeof child === "boolean") {
          return createVNode(Comment);
        } else if (shared.isArray(child)) {
          return createVNode(
            Fragment,
            null,
            // #3666, avoid reference pollution when reusing vnode
            child.slice()
          );
        } else if (isVNode(child)) {
          return cloneIfMounted(child);
        } else {
          return createVNode(Text, null, String(child));
        }
      }
      function cloneIfMounted(child) {
        return child.el === null && child.patchFlag !== -1 || child.memo ? child : cloneVNode(child);
      }
      function normalizeChildren(vnode, children) {
        let type = 0;
        const { shapeFlag } = vnode;
        if (children == null) {
          children = null;
        } else if (shared.isArray(children)) {
          type = 16;
        } else if (typeof children === "object") {
          if (shapeFlag & (1 | 64)) {
            const slot = children.default;
            if (slot) {
              slot._c && (slot._d = false);
              normalizeChildren(vnode, slot());
              slot._c && (slot._d = true);
            }
            return;
          } else {
            type = 32;
            const slotFlag = children._;
            if (!slotFlag && !isInternalObject(children)) {
              children._ctx = currentRenderingInstance;
            } else if (slotFlag === 3 && currentRenderingInstance) {
              if (currentRenderingInstance.slots._ === 1) {
                children._ = 1;
              } else {
                children._ = 2;
                vnode.patchFlag |= 1024;
              }
            }
          }
        } else if (shared.isFunction(children)) {
          if (shapeFlag & (1 | 64)) {
            normalizeChildren(vnode, { default: children });
            return;
          }
          children = { default: children, _ctx: currentRenderingInstance };
          type = 32;
        } else {
          children = String(children);
          if (shapeFlag & 64) {
            type = 16;
            children = [createTextVNode(children)];
          } else {
            type = 8;
          }
        }
        vnode.children = children;
        vnode.shapeFlag |= type;
      }
      function mergeProps(...args) {
        const ret = {};
        for (let i = 0; i < args.length; i++) {
          const toMerge = args[i];
          for (const key in toMerge) {
            if (key === "class") {
              if (ret.class !== toMerge.class) {
                ret.class = shared.normalizeClass([ret.class, toMerge.class]);
              }
            } else if (key === "style") {
              ret.style = shared.normalizeStyle([ret.style, toMerge.style]);
            } else if (shared.isOn(key)) {
              const existing = ret[key];
              const incoming = toMerge[key];
              if (incoming && existing !== incoming && !(shared.isArray(existing) && existing.includes(incoming))) {
                ret[key] = existing ? [].concat(existing, incoming) : incoming;
              } else if (incoming == null && existing == null && // mergeProps({ 'onUpdate:modelValue': undefined }) should not retain
              // the model listener.
              !shared.isModelListener(key)) {
                ret[key] = incoming;
              }
            } else if (key !== "") {
              ret[key] = toMerge[key];
            }
          }
        }
        return ret;
      }
      function invokeVNodeHook(hook, instance, vnode, prevVNode = null) {
        callWithAsyncErrorHandling(hook, instance, 7, [
          vnode,
          prevVNode
        ]);
      }
      var emptyAppContext = createAppContext();
      var uid = 0;
      function createComponentInstance(vnode, parent, suspense) {
        const type = vnode.type;
        const appContext = (parent ? parent.appContext : vnode.appContext) || emptyAppContext;
        const instance = {
          uid: uid++,
          vnode,
          type,
          parent,
          appContext,
          root: null,
          // to be immediately set
          next: null,
          subTree: null,
          // will be set synchronously right after creation
          effect: null,
          update: null,
          // will be set synchronously right after creation
          job: null,
          scope: new reactivity.EffectScope(
            true
            /* detached */
          ),
          render: null,
          proxy: null,
          exposed: null,
          exposeProxy: null,
          withProxy: null,
          provides: parent ? parent.provides : Object.create(appContext.provides),
          ids: parent ? parent.ids : ["", 0, 0],
          accessCache: null,
          renderCache: [],
          // local resolved assets
          components: null,
          directives: null,
          // resolved props and emits options
          propsOptions: normalizePropsOptions(type, appContext),
          emitsOptions: normalizeEmitsOptions(type, appContext),
          // emit
          emit: null,
          // to be set immediately
          emitted: null,
          // props default value
          propsDefaults: shared.EMPTY_OBJ,
          // inheritAttrs
          inheritAttrs: type.inheritAttrs,
          // state
          ctx: shared.EMPTY_OBJ,
          data: shared.EMPTY_OBJ,
          props: shared.EMPTY_OBJ,
          attrs: shared.EMPTY_OBJ,
          slots: shared.EMPTY_OBJ,
          refs: shared.EMPTY_OBJ,
          setupState: shared.EMPTY_OBJ,
          setupContext: null,
          // suspense related
          suspense,
          suspenseId: suspense ? suspense.pendingId : 0,
          asyncDep: null,
          asyncResolved: false,
          // lifecycle hooks
          // not using enums here because it results in computed properties
          isMounted: false,
          isUnmounted: false,
          isDeactivated: false,
          bc: null,
          c: null,
          bm: null,
          m: null,
          bu: null,
          u: null,
          um: null,
          bum: null,
          da: null,
          a: null,
          rtg: null,
          rtc: null,
          ec: null,
          sp: null
        };
        {
          instance.ctx = createDevRenderContext(instance);
        }
        instance.root = parent ? parent.root : instance;
        instance.emit = emit.bind(null, instance);
        if (vnode.ce) {
          vnode.ce(instance);
        }
        return instance;
      }
      var currentInstance = null;
      var getCurrentInstance = () => currentInstance || currentRenderingInstance;
      var internalSetCurrentInstance;
      var setInSSRSetupState;
      {
        const g2 = shared.getGlobalThis();
        const registerGlobalSetter = (key, setter) => {
          let setters;
          if (!(setters = g2[key])) setters = g2[key] = [];
          setters.push(setter);
          return (v) => {
            if (setters.length > 1) setters.forEach((set) => set(v));
            else setters[0](v);
          };
        };
        internalSetCurrentInstance = registerGlobalSetter(
          `__VUE_INSTANCE_SETTERS__`,
          (v) => currentInstance = v
        );
        setInSSRSetupState = registerGlobalSetter(
          `__VUE_SSR_SETTERS__`,
          (v) => isInSSRComponentSetup = v
        );
      }
      var setCurrentInstance = (instance) => {
        const prev = currentInstance;
        internalSetCurrentInstance(instance);
        instance.scope.on();
        return () => {
          instance.scope.off();
          internalSetCurrentInstance(prev);
        };
      };
      var unsetCurrentInstance = () => {
        currentInstance && currentInstance.scope.off();
        internalSetCurrentInstance(null);
      };
      var isBuiltInTag = /* @__PURE__ */ shared.makeMap("slot,component");
      function validateComponentName(name, { isNativeTag }) {
        if (isBuiltInTag(name) || isNativeTag(name)) {
          warn$1(
            "Do not use built-in or reserved HTML elements as component id: " + name
          );
        }
      }
      function isStatefulComponent(instance) {
        return instance.vnode.shapeFlag & 4;
      }
      var isInSSRComponentSetup = false;
      function setupComponent(instance, isSSR = false, optimized = false) {
        isSSR && setInSSRSetupState(isSSR);
        const { props, children } = instance.vnode;
        const isStateful = isStatefulComponent(instance);
        initProps(instance, props, isStateful, isSSR);
        initSlots(instance, children, optimized || isSSR);
        const setupResult = isStateful ? setupStatefulComponent(instance, isSSR) : void 0;
        isSSR && setInSSRSetupState(false);
        return setupResult;
      }
      function setupStatefulComponent(instance, isSSR) {
        const Component = instance.type;
        {
          if (Component.name) {
            validateComponentName(Component.name, instance.appContext.config);
          }
          if (Component.components) {
            const names = Object.keys(Component.components);
            for (let i = 0; i < names.length; i++) {
              validateComponentName(names[i], instance.appContext.config);
            }
          }
          if (Component.directives) {
            const names = Object.keys(Component.directives);
            for (let i = 0; i < names.length; i++) {
              validateDirectiveName(names[i]);
            }
          }
          if (Component.compilerOptions && isRuntimeOnly()) {
            warn$1(
              `"compilerOptions" is only supported when using a build of Vue that includes the runtime compiler. Since you are using a runtime-only build, the options should be passed via your build tool config instead.`
            );
          }
        }
        instance.accessCache = /* @__PURE__ */ Object.create(null);
        instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers);
        {
          exposePropsOnRenderContext(instance);
        }
        const { setup } = Component;
        if (setup) {
          reactivity.pauseTracking();
          const setupContext = instance.setupContext = setup.length > 1 ? createSetupContext(instance) : null;
          const reset = setCurrentInstance(instance);
          const setupResult = callWithErrorHandling(
            setup,
            instance,
            0,
            [
              reactivity.shallowReadonly(instance.props),
              setupContext
            ]
          );
          const isAsyncSetup = shared.isPromise(setupResult);
          reactivity.resetTracking();
          reset();
          if ((isAsyncSetup || instance.sp) && !isAsyncWrapper(instance)) {
            markAsyncBoundary(instance);
          }
          if (isAsyncSetup) {
            setupResult.then(unsetCurrentInstance, unsetCurrentInstance);
            if (isSSR) {
              return setupResult.then((resolvedResult) => {
                setInSSRSetupState(true);
                try {
                  handleSetupResult(instance, resolvedResult, isSSR);
                } finally {
                  setInSSRSetupState(false);
                }
              }).catch((e) => {
                handleError(e, instance, 0);
              });
            } else {
              instance.asyncDep = setupResult;
              if (!instance.suspense) {
                const name = formatComponentName(instance, Component);
                warn$1(
                  `Component <${name}>: setup function returned a promise, but no <Suspense> boundary was found in the parent component tree. A component with async setup() must be nested in a <Suspense> in order to be rendered.`
                );
              }
            }
          } else {
            handleSetupResult(instance, setupResult, isSSR);
          }
        } else {
          finishComponentSetup(instance, isSSR);
        }
      }
      function handleSetupResult(instance, setupResult, isSSR) {
        if (shared.isFunction(setupResult)) {
          if (instance.type.__ssrInlineRender) {
            instance.ssrRender = setupResult;
          } else {
            instance.render = setupResult;
          }
        } else if (shared.isObject(setupResult)) {
          if (isVNode(setupResult)) {
            warn$1(
              `setup() should not return VNodes directly - return a render function instead.`
            );
          }
          {
            instance.devtoolsRawSetupState = setupResult;
          }
          instance.setupState = reactivity.proxyRefs(setupResult);
          {
            exposeSetupStateOnRenderContext(instance);
          }
        } else if (setupResult !== void 0) {
          warn$1(
            `setup() should return an object. Received: ${setupResult === null ? "null" : typeof setupResult}`
          );
        }
        finishComponentSetup(instance, isSSR);
      }
      var compile;
      var installWithProxy;
      function registerRuntimeCompiler(_compile) {
        compile = _compile;
        installWithProxy = (i) => {
          if (i.render._rc) {
            i.withProxy = new Proxy(i.ctx, RuntimeCompiledPublicInstanceProxyHandlers);
          }
        };
      }
      var isRuntimeOnly = () => !compile;
      function finishComponentSetup(instance, isSSR, skipOptions) {
        const Component = instance.type;
        if (!instance.render) {
          if (!isSSR && compile && !Component.render) {
            const template = Component.template || resolveMergedOptions(instance).template;
            if (template) {
              {
                startMeasure(instance, `compile`);
              }
              const { isCustomElement, compilerOptions } = instance.appContext.config;
              const { delimiters, compilerOptions: componentCompilerOptions } = Component;
              const finalCompilerOptions = shared.extend(
                shared.extend(
                  {
                    isCustomElement,
                    delimiters
                  },
                  compilerOptions
                ),
                componentCompilerOptions
              );
              Component.render = compile(template, finalCompilerOptions);
              {
                endMeasure(instance, `compile`);
              }
            }
          }
          instance.render = Component.render || shared.NOOP;
          if (installWithProxy) {
            installWithProxy(instance);
          }
        }
        {
          const reset = setCurrentInstance(instance);
          reactivity.pauseTracking();
          try {
            applyOptions(instance);
          } finally {
            reactivity.resetTracking();
            reset();
          }
        }
        if (!Component.render && instance.render === shared.NOOP && !isSSR) {
          if (!compile && Component.template) {
            warn$1(
              `Component provided template option but runtime compilation is not supported in this build of Vue.`
            );
          } else {
            warn$1(`Component is missing template or render function: `, Component);
          }
        }
      }
      var attrsProxyHandlers = {
        get(target, key) {
          markAttrsAccessed();
          reactivity.track(target, "get", "");
          return target[key];
        },
        set() {
          warn$1(`setupContext.attrs is readonly.`);
          return false;
        },
        deleteProperty() {
          warn$1(`setupContext.attrs is readonly.`);
          return false;
        }
      };
      function getSlotsProxy(instance) {
        return new Proxy(instance.slots, {
          get(target, key) {
            reactivity.track(instance, "get", "$slots");
            return target[key];
          }
        });
      }
      function createSetupContext(instance) {
        const expose = (exposed) => {
          {
            if (instance.exposed) {
              warn$1(`expose() should be called only once per setup().`);
            }
            if (exposed != null) {
              let exposedType = typeof exposed;
              if (exposedType === "object") {
                if (shared.isArray(exposed)) {
                  exposedType = "array";
                } else if (reactivity.isRef(exposed)) {
                  exposedType = "ref";
                }
              }
              if (exposedType !== "object") {
                warn$1(
                  `expose() should be passed a plain object, received ${exposedType}.`
                );
              }
            }
          }
          instance.exposed = exposed || {};
        };
        {
          let attrsProxy;
          let slotsProxy;
          return Object.freeze({
            get attrs() {
              return attrsProxy || (attrsProxy = new Proxy(instance.attrs, attrsProxyHandlers));
            },
            get slots() {
              return slotsProxy || (slotsProxy = getSlotsProxy(instance));
            },
            get emit() {
              return (event, ...args) => instance.emit(event, ...args);
            },
            expose
          });
        }
      }
      function getComponentPublicInstance(instance) {
        if (instance.exposed) {
          return instance.exposeProxy || (instance.exposeProxy = new Proxy(reactivity.proxyRefs(reactivity.markRaw(instance.exposed)), {
            get(target, key) {
              if (key in target) {
                return target[key];
              } else if (key in publicPropertiesMap) {
                return publicPropertiesMap[key](instance);
              }
            },
            has(target, key) {
              return key in target || key in publicPropertiesMap;
            }
          }));
        } else {
          return instance.proxy;
        }
      }
      var classifyRE = /(?:^|[-_])\w/g;
      var classify = (str) => str.replace(classifyRE, (c) => c.toUpperCase()).replace(/[-_]/g, "");
      function getComponentName(Component, includeInferred = true) {
        return shared.isFunction(Component) ? Component.displayName || Component.name : Component.name || includeInferred && Component.__name;
      }
      function formatComponentName(instance, Component, isRoot = false) {
        let name = getComponentName(Component);
        if (!name && Component.__file) {
          const match = Component.__file.match(/([^/\\]+)\.\w+$/);
          if (match) {
            name = match[1];
          }
        }
        if (!name && instance) {
          const inferFromRegistry = (registry) => {
            for (const key in registry) {
              if (registry[key] === Component) {
                return key;
              }
            }
          };
          name = inferFromRegistry(instance.components) || instance.parent && inferFromRegistry(
            instance.parent.type.components
          ) || inferFromRegistry(instance.appContext.components);
        }
        return name ? classify(name) : isRoot ? `App` : `Anonymous`;
      }
      function isClassComponent(value) {
        return shared.isFunction(value) && "__vccOpts" in value;
      }
      var computed = (getterOrOptions, debugOptions) => {
        const c = reactivity.computed(getterOrOptions, debugOptions, isInSSRComponentSetup);
        {
          const i = getCurrentInstance();
          if (i && i.appContext.config.warnRecursiveComputed) {
            c._warnRecursive = true;
          }
        }
        return c;
      };
      function h2(type, propsOrChildren, children) {
        try {
          setBlockTracking(-1);
          const l = arguments.length;
          if (l === 2) {
            if (shared.isObject(propsOrChildren) && !shared.isArray(propsOrChildren)) {
              if (isVNode(propsOrChildren)) {
                return createVNode(type, null, [propsOrChildren]);
              }
              return createVNode(type, propsOrChildren);
            } else {
              return createVNode(type, null, propsOrChildren);
            }
          } else {
            if (l > 3) {
              children = Array.prototype.slice.call(arguments, 2);
            } else if (l === 3 && isVNode(children)) {
              children = [children];
            }
            return createVNode(type, propsOrChildren, children);
          }
        } finally {
          setBlockTracking(1);
        }
      }
      function initCustomFormatter() {
        if (typeof window === "undefined") {
          return;
        }
        const vueStyle = { style: "color:#3ba776" };
        const numberStyle = { style: "color:#1677ff" };
        const stringStyle = { style: "color:#f5222d" };
        const keywordStyle = { style: "color:#eb2f96" };
        const formatter = {
          __vue_custom_formatter: true,
          header(obj) {
            if (!shared.isObject(obj)) {
              return null;
            }
            if (obj.__isVue) {
              return ["div", vueStyle, `VueInstance`];
            } else if (reactivity.isRef(obj)) {
              reactivity.pauseTracking();
              const value = obj.value;
              reactivity.resetTracking();
              return [
                "div",
                {},
                ["span", vueStyle, genRefFlag(obj)],
                "<",
                formatValue(value),
                `>`
              ];
            } else if (reactivity.isReactive(obj)) {
              return [
                "div",
                {},
                ["span", vueStyle, reactivity.isShallow(obj) ? "ShallowReactive" : "Reactive"],
                "<",
                formatValue(obj),
                `>${reactivity.isReadonly(obj) ? ` (readonly)` : ``}`
              ];
            } else if (reactivity.isReadonly(obj)) {
              return [
                "div",
                {},
                ["span", vueStyle, reactivity.isShallow(obj) ? "ShallowReadonly" : "Readonly"],
                "<",
                formatValue(obj),
                ">"
              ];
            }
            return null;
          },
          hasBody(obj) {
            return obj && obj.__isVue;
          },
          body(obj) {
            if (obj && obj.__isVue) {
              return [
                "div",
                {},
                ...formatInstance(obj.$)
              ];
            }
          }
        };
        function formatInstance(instance) {
          const blocks = [];
          if (instance.type.props && instance.props) {
            blocks.push(createInstanceBlock("props", reactivity.toRaw(instance.props)));
          }
          if (instance.setupState !== shared.EMPTY_OBJ) {
            blocks.push(createInstanceBlock("setup", instance.setupState));
          }
          if (instance.data !== shared.EMPTY_OBJ) {
            blocks.push(createInstanceBlock("data", reactivity.toRaw(instance.data)));
          }
          const computed2 = extractKeys(instance, "computed");
          if (computed2) {
            blocks.push(createInstanceBlock("computed", computed2));
          }
          const injected = extractKeys(instance, "inject");
          if (injected) {
            blocks.push(createInstanceBlock("injected", injected));
          }
          blocks.push([
            "div",
            {},
            [
              "span",
              {
                style: keywordStyle.style + ";opacity:0.66"
              },
              "$ (internal): "
            ],
            ["object", { object: instance }]
          ]);
          return blocks;
        }
        function createInstanceBlock(type, target) {
          target = shared.extend({}, target);
          if (!Object.keys(target).length) {
            return ["span", {}];
          }
          return [
            "div",
            { style: "line-height:1.25em;margin-bottom:0.6em" },
            [
              "div",
              {
                style: "color:#476582"
              },
              type
            ],
            [
              "div",
              {
                style: "padding-left:1.25em"
              },
              ...Object.keys(target).map((key) => {
                return [
                  "div",
                  {},
                  ["span", keywordStyle, key + ": "],
                  formatValue(target[key], false)
                ];
              })
            ]
          ];
        }
        function formatValue(v, asRaw = true) {
          if (typeof v === "number") {
            return ["span", numberStyle, v];
          } else if (typeof v === "string") {
            return ["span", stringStyle, JSON.stringify(v)];
          } else if (typeof v === "boolean") {
            return ["span", keywordStyle, v];
          } else if (shared.isObject(v)) {
            return ["object", { object: asRaw ? reactivity.toRaw(v) : v }];
          } else {
            return ["span", stringStyle, String(v)];
          }
        }
        function extractKeys(instance, type) {
          const Comp = instance.type;
          if (shared.isFunction(Comp)) {
            return;
          }
          const extracted = {};
          for (const key in instance.ctx) {
            if (isKeyOfType(Comp, key, type)) {
              extracted[key] = instance.ctx[key];
            }
          }
          return extracted;
        }
        function isKeyOfType(Comp, key, type) {
          const opts = Comp[type];
          if (shared.isArray(opts) && opts.includes(key) || shared.isObject(opts) && key in opts) {
            return true;
          }
          if (Comp.extends && isKeyOfType(Comp.extends, key, type)) {
            return true;
          }
          if (Comp.mixins && Comp.mixins.some((m) => isKeyOfType(m, key, type))) {
            return true;
          }
        }
        function genRefFlag(v) {
          if (reactivity.isShallow(v)) {
            return `ShallowRef`;
          }
          if (v.effect) {
            return `ComputedRef`;
          }
          return `Ref`;
        }
        if (window.devtoolsFormatters) {
          window.devtoolsFormatters.push(formatter);
        } else {
          window.devtoolsFormatters = [formatter];
        }
      }
      function withMemo(memo, render2, cache2, index) {
        const cached = cache2[index];
        if (cached && isMemoSame(cached, memo)) {
          return cached;
        }
        const ret = render2();
        ret.memo = memo.slice();
        ret.cacheIndex = index;
        return cache2[index] = ret;
      }
      function isMemoSame(cached, memo) {
        const prev = cached.memo;
        if (prev.length != memo.length) {
          return false;
        }
        for (let i = 0; i < prev.length; i++) {
          if (shared.hasChanged(prev[i], memo[i])) {
            return false;
          }
        }
        if (isBlockTreeEnabled > 0 && currentBlock) {
          currentBlock.push(cached);
        }
        return true;
      }
      var version = "3.5.42";
      var warn = warn$1;
      var ErrorTypeStrings = ErrorTypeStrings$1;
      var devtools = devtools$1;
      var setDevtoolsHook = setDevtoolsHook$1;
      var _ssrUtils = {
        createComponentInstance,
        setupComponent,
        renderComponentRoot,
        setCurrentRenderingInstance,
        isVNode,
        normalizeVNode,
        getComponentPublicInstance,
        ensureValidVNode,
        pushWarningContext,
        popWarningContext
      };
      var ssrUtils = _ssrUtils;
      var resolveFilter = null;
      var compatUtils = null;
      var DeprecationTypes = null;
      exports.EffectScope = reactivity.EffectScope;
      exports.ReactiveEffect = reactivity.ReactiveEffect;
      exports.TrackOpTypes = reactivity.TrackOpTypes;
      exports.TriggerOpTypes = reactivity.TriggerOpTypes;
      exports.customRef = reactivity.customRef;
      exports.effect = reactivity.effect;
      exports.effectScope = reactivity.effectScope;
      exports.getCurrentScope = reactivity.getCurrentScope;
      exports.getCurrentWatcher = reactivity.getCurrentWatcher;
      exports.isProxy = reactivity.isProxy;
      exports.isReactive = reactivity.isReactive;
      exports.isReadonly = reactivity.isReadonly;
      exports.isRef = reactivity.isRef;
      exports.isShallow = reactivity.isShallow;
      exports.markRaw = reactivity.markRaw;
      exports.onScopeDispose = reactivity.onScopeDispose;
      exports.onWatcherCleanup = reactivity.onWatcherCleanup;
      exports.proxyRefs = reactivity.proxyRefs;
      exports.reactive = reactivity.reactive;
      exports.readonly = reactivity.readonly;
      exports.ref = reactivity.ref;
      exports.shallowReactive = reactivity.shallowReactive;
      exports.shallowReadonly = reactivity.shallowReadonly;
      exports.shallowRef = reactivity.shallowRef;
      exports.stop = reactivity.stop;
      exports.toRaw = reactivity.toRaw;
      exports.toRef = reactivity.toRef;
      exports.toRefs = reactivity.toRefs;
      exports.toValue = reactivity.toValue;
      exports.triggerRef = reactivity.triggerRef;
      exports.unref = reactivity.unref;
      exports.camelize = shared.camelize;
      exports.capitalize = shared.capitalize;
      exports.normalizeClass = shared.normalizeClass;
      exports.normalizeProps = shared.normalizeProps;
      exports.normalizeStyle = shared.normalizeStyle;
      exports.toDisplayString = shared.toDisplayString;
      exports.toHandlerKey = shared.toHandlerKey;
      exports.BaseTransition = BaseTransition;
      exports.BaseTransitionPropsValidators = BaseTransitionPropsValidators;
      exports.Comment = Comment;
      exports.DeprecationTypes = DeprecationTypes;
      exports.ErrorCodes = ErrorCodes;
      exports.ErrorTypeStrings = ErrorTypeStrings;
      exports.Fragment = Fragment;
      exports.KeepAlive = KeepAlive;
      exports.Static = Static;
      exports.Suspense = Suspense;
      exports.Teleport = Teleport;
      exports.Text = Text;
      exports.assertNumber = assertNumber;
      exports.callWithAsyncErrorHandling = callWithAsyncErrorHandling;
      exports.callWithErrorHandling = callWithErrorHandling;
      exports.cloneVNode = cloneVNode;
      exports.compatUtils = compatUtils;
      exports.computed = computed;
      exports.createBlock = createBlock;
      exports.createCommentVNode = createCommentVNode;
      exports.createElementBlock = createElementBlock;
      exports.createElementVNode = createBaseVNode;
      exports.createHydrationRenderer = createHydrationRenderer;
      exports.createPropsRestProxy = createPropsRestProxy;
      exports.createRenderer = createRenderer2;
      exports.createSlots = createSlots;
      exports.createStaticVNode = createStaticVNode;
      exports.createTextVNode = createTextVNode;
      exports.createVNode = createVNode;
      exports.defineAsyncComponent = defineAsyncComponent;
      exports.defineComponent = defineComponent2;
      exports.defineEmits = defineEmits;
      exports.defineExpose = defineExpose;
      exports.defineModel = defineModel;
      exports.defineOptions = defineOptions;
      exports.defineProps = defineProps;
      exports.defineSlots = defineSlots;
      exports.devtools = devtools;
      exports.getCurrentInstance = getCurrentInstance;
      exports.getTransitionRawChildren = getTransitionRawChildren;
      exports.guardReactiveProps = guardReactiveProps;
      exports.h = h2;
      exports.handleError = handleError;
      exports.hasInjectionContext = hasInjectionContext;
      exports.hydrateOnIdle = hydrateOnIdle;
      exports.hydrateOnInteraction = hydrateOnInteraction;
      exports.hydrateOnMediaQuery = hydrateOnMediaQuery;
      exports.hydrateOnVisible = hydrateOnVisible;
      exports.initCustomFormatter = initCustomFormatter;
      exports.inject = inject;
      exports.isMemoSame = isMemoSame;
      exports.isRuntimeOnly = isRuntimeOnly;
      exports.isVNode = isVNode;
      exports.mergeDefaults = mergeDefaults;
      exports.mergeModels = mergeModels;
      exports.mergeProps = mergeProps;
      exports.nextTick = nextTick;
      exports.onActivated = onActivated;
      exports.onBeforeMount = onBeforeMount;
      exports.onBeforeUnmount = onBeforeUnmount;
      exports.onBeforeUpdate = onBeforeUpdate;
      exports.onDeactivated = onDeactivated;
      exports.onErrorCaptured = onErrorCaptured;
      exports.onMounted = onMounted;
      exports.onRenderTracked = onRenderTracked;
      exports.onRenderTriggered = onRenderTriggered;
      exports.onServerPrefetch = onServerPrefetch;
      exports.onUnmounted = onUnmounted;
      exports.onUpdated = onUpdated;
      exports.openBlock = openBlock;
      exports.popScopeId = popScopeId;
      exports.provide = provide;
      exports.pushScopeId = pushScopeId;
      exports.queuePostFlushCb = queuePostFlushCb;
      exports.registerRuntimeCompiler = registerRuntimeCompiler;
      exports.renderList = renderList;
      exports.renderSlot = renderSlot;
      exports.resolveComponent = resolveComponent;
      exports.resolveDirective = resolveDirective;
      exports.resolveDynamicComponent = resolveDynamicComponent;
      exports.resolveFilter = resolveFilter;
      exports.resolveTransitionHooks = resolveTransitionHooks;
      exports.setBlockTracking = setBlockTracking;
      exports.setDevtoolsHook = setDevtoolsHook;
      exports.setTransitionHooks = setTransitionHooks;
      exports.ssrContextKey = ssrContextKey;
      exports.ssrUtils = ssrUtils;
      exports.toHandlers = toHandlers;
      exports.transformVNodeArgs = transformVNodeArgs;
      exports.useAttrs = useAttrs;
      exports.useId = useId;
      exports.useModel = useModel;
      exports.useSSRContext = useSSRContext;
      exports.useSlots = useSlots;
      exports.useTemplateRef = useTemplateRef;
      exports.useTransitionState = useTransitionState;
      exports.version = version;
      exports.warn = warn;
      exports.watch = watch;
      exports.watchEffect = watchEffect;
      exports.watchPostEffect = watchPostEffect;
      exports.watchSyncEffect = watchSyncEffect;
      exports.withAsyncContext = withAsyncContext;
      exports.withCtx = withCtx;
      exports.withDefaults = withDefaults;
      exports.withDirectives = withDirectives;
      exports.withMemo = withMemo;
      exports.withScopeId = withScopeId;
    }
  });

  // node_modules/.pnpm/@vue+runtime-core@3.5.42/node_modules/@vue/runtime-core/index.js
  var require_runtime_core = __commonJS({
    "node_modules/.pnpm/@vue+runtime-core@3.5.42/node_modules/@vue/runtime-core/index.js"(exports, module) {
      "use strict";
      if (false) {
        module.exports = null;
      } else {
        module.exports = require_runtime_core_cjs();
      }
    }
  });

  // specs/093-devtools-tree-lazy-and-live/e2e/app-entry.js
  var import_runtime_core2 = __toESM(require_runtime_core(), 1);

  // packages/fjs-runtime/src/microtask.ts
  var g = globalThis;
  if (typeof g.queueMicrotask !== "function") {
    g.queueMicrotask = (cb) => {
      Promise.resolve().then(cb);
    };
  }

  // packages/fjs-runtime/src/ui/drawable-text.ts
  function drawableText(text) {
    return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  }

  // packages/fjs-runtime/src/ui/utf8.ts
  function utf8Encode(input) {
    const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
    if (enc) return enc.encode(input);
    let outLen = 0;
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code < 128) outLen += 1;
      else if (code < 2048) outLen += 2;
      else if (code >= 55296 && code <= 56319 && i + 1 < input.length) outLen += 4;
      else outLen += 3;
    }
    const out = new Uint8Array(outLen);
    let p = 0;
    for (let i = 0; i < input.length; i++) {
      let code = input.charCodeAt(i);
      if (code >= 55296 && code <= 56319 && i + 1 < input.length) {
        const lo = input.charCodeAt(i + 1);
        if (lo >= 56320 && lo <= 57343) {
          code = 65536 + (code - 55296 << 10) + (lo - 56320);
          i++;
        } else {
          code = 65533;
        }
      } else if (code >= 55296 && code <= 57343) {
        code = 65533;
      }
      if (code < 128) {
        out[p++] = code;
      } else if (code < 2048) {
        out[p++] = 192 | code >> 6;
        out[p++] = 128 | code & 63;
      } else if (code < 65536) {
        out[p++] = 224 | code >> 12;
        out[p++] = 128 | code >> 6 & 63;
        out[p++] = 128 | code & 63;
      } else {
        out[p++] = 240 | code >> 18;
        out[p++] = 128 | code >> 12 & 63;
        out[p++] = 128 | code >> 6 & 63;
        out[p++] = 128 | code & 63;
      }
    }
    return out;
  }

  // packages/fjs-runtime/src/ui/ops.ts
  var STYLE_TABLE_MAX = 2048;
  function hostUiOpsVersion() {
    var _a4;
    const declared2 = (_a4 = globalThis.__fjsHost) == null ? void 0 : _a4.uiOpsVersion;
    return typeof declared2 === "number" ? declared2 : 1;
  }
  var warnedOldHost = /* @__PURE__ */ new Set();
  function warnOldHostOnce(what = "canvas") {
    if (warnedOldHost.has(what)) return;
    warnedOldHost.add(what);
    console.warn(
      `[fjs] host is too old for ${what === "canvas" ? "<canvas>" : what} (op protocol too low); nothing will be drawn. Update the flutter_fjs host.`
    );
  }
  var OpWriter = class {
    constructor() {
      this.buf = new Uint8Array(8192);
      this.len = 0;
      this.legacyStyleJson = /* @__PURE__ */ new WeakMap();
      this.cachedUiOpsVersion = 0;
      /** Object identity -> id. A WeakMap so a style the engine has dropped stops
       * pinning its id; `nextStyleId` never rewinds, which keeps a misordered or
       * truncated frame diagnosable instead of silently aliasing two styles. */
      this.styleIds = /* @__PURE__ */ new WeakMap();
      /** Ids the peer currently holds definitions for. */
      this.defined = /* @__PURE__ */ new Set();
      this.nextStyleId = 1;
    }
    ensure(n) {
      if (this.len + n <= this.buf.length) return;
      let cap = this.buf.length;
      while (cap < this.len + n) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
    }
    u8(v) {
      this.ensure(1);
      this.buf[this.len++] = v & 255;
    }
    u32(v) {
      this.ensure(4);
      const b = this.buf;
      let p = this.len;
      b[p++] = v >>> 0 & 255;
      b[p++] = v >>> 8 & 255;
      b[p++] = v >>> 16 & 255;
      b[p++] = v >>> 24 & 255;
      this.len = p;
    }
    u16(v) {
      this.ensure(2);
      const b = this.buf;
      let p = this.len;
      b[p++] = v >>> 0 & 255;
      b[p++] = v >>> 8 & 255;
      this.len = p;
    }
    bytes(b) {
      this.ensure(b.length);
      this.buf.set(b, this.len);
      this.len += b.length;
    }
    utf8(s) {
      this.bytes(utf8Encode(s));
    }
    create(id, tag) {
      this.u8(1 /* Create */);
      this.u32(id);
      const encoded = utf8Encode(tag);
      this.u16(encoded.length);
      this.bytes(encoded);
      return this;
    }
    remove(id) {
      this.u8(2 /* Remove */);
      this.u32(id);
      return this;
    }
    insert(parent, child, index) {
      this.u8(3 /* Insert */);
      this.u32(parent);
      this.u32(child);
      this.u32(index);
      return this;
    }
    removeChild(parent, child) {
      this.u8(4 /* RemoveChild */);
      this.u32(parent);
      this.u32(child);
      return this;
    }
    setText(id, text) {
      const encoded = utf8Encode(drawableText(text));
      this.u8(5 /* SetText */);
      this.u32(id);
      this.u32(encoded.length);
      this.bytes(encoded);
      return this;
    }
    /** One canvas node's new drawing commands for this frame. The bytes are
     * the display list canvas/display-list.ts writes; this layer does not look
     * inside them (canvas/canvas_ops.dart is the decoder's twin).
     *
     * Drawing is a STREAM, not a property: two frames of commands append, they
     * do not replace each other, which is why this is its own op rather than a
     * key inside SetProps. A host too old to decode op 10 is told once and the
     * commands are dropped — silently painting nothing is the failure mode
     * constitution V exists to prevent, and a JSON fallback would mean
     * maintaining a second encoding for hosts that are already out of date. */
    canvas(id, commands) {
      if (this.uiOpsVersion < 3) {
        warnOldHostOnce();
        return this;
      }
      this.u8(10 /* Canvas */);
      this.u32(id);
      this.u32(commands.length);
      this.bytes(commands);
      return this;
    }
    /** One canvas node's new WebGL commands for this frame. The bytes are the
     * command stream canvas/webgl/protocol.ts writes; this layer does not look
     * inside them (canvas/webgl_replay.dart is the decoder's twin).
     *
     * Unlike op 10 these are EXECUTED, not retained: the host runs each chunk
     * into the node's GL framebuffer as it arrives and marks its texture for
     * display. Same degradation rule as op 10 — an old host is told once and
     * the commands are dropped, never silently blank. */
    webgl(id, commands) {
      if (this.uiOpsVersion < 5) {
        warnOldHostOnce("webgl");
        return this;
      }
      this.u8(11 /* Webgl */);
      this.u32(id);
      this.u32(commands.length);
      this.bytes(commands);
      return this;
    }
    setProps(id, props) {
      return this.writeProps(id, utf8Encode(JSON.stringify(props)));
    }
    /** The `:hover` variant of a node's computed style, keyed like SetStyle's
     * active slot: replace semantics, id 0 clears. This is its own op rather
     * than a third slot inside SetStyle because widening SetStyle would leave
     * the decoder no way to tell which width an OLD runtime is sending — the
     * host's declared uiOpsVersion only flows one way, so an old runtime paired
     * with a new host reads every version gate as passed and keeps writing 12
     * bytes. A new opcode (the op 10/11 shape) degrades cleanly in both
     * directions: a new runtime gates on the version and never sends it to an
     * old host; an old runtime never emits it at all. */
    setHoverStyle(id, style) {
      if (this.uiOpsVersion < 6) {
        if (style) warnOldHostOnce(":hover");
        return this;
      }
      const hid = style ? this.styleId(style) : 0;
      this.u8(12 /* SetHoverStyle */);
      this.u32(id);
      this.u32(hid);
      return this;
    }
    /** Style assignment for a computed style map. The style engine hands the
     * same (immutable) object to every element with an identical computed
     * style, so the map itself crosses the bridge ONCE per frame (DefineStyle)
     * and each element only references it by id (SetStyle, 13 bytes).
     *
     * Both slots are replace, not merge: passing no `activeStyle` clears the
     * pressed variant the peer is holding. That matches the only caller — the
     * renderer's applyStyle only omits it for elements that never matched an
     * `:active` rule.
     */
    setStyle(id, style, activeStyle) {
      if (this.uiOpsVersion < 2) return this.setStyleAsProps(id, style, activeStyle);
      const sid = this.styleId(style);
      const aid = activeStyle ? this.styleId(activeStyle) : 0;
      this.u8(8 /* SetStyle */);
      this.u32(id);
      this.u32(sid);
      this.u32(aid);
      return this;
    }
    /** Interns a style object, emitting its definition the first time the peer
     * needs to know it. Ids come off object identity, so two elements that the
     * style engine collapsed onto one computed style share an id for free. */
    styleId(style) {
      let id = this.styleIds.get(style);
      if (id === void 0) {
        id = this.nextStyleId++;
        this.styleIds.set(style, id);
      }
      if (!this.defined.has(id)) {
        if (this.defined.size >= STYLE_TABLE_MAX) {
          this.u8(9 /* ResetStyles */);
          this.defined.clear();
        }
        const json = utf8Encode(JSON.stringify(style));
        this.u8(7 /* DefineStyle */);
        this.u32(id);
        this.u32(json.length);
        this.bytes(json);
        this.defined.add(id);
      }
      return id;
    }
    /** Pre-interning encoding: the whole style map inlined into a SetProps for
     * every element. Only reachable against a host too old to decode ops 7-9. */
    setStyleAsProps(id, style, activeStyle) {
      if (activeStyle !== void 0) {
        return this.writeProps(
          id,
          utf8Encode(JSON.stringify({ style, activeStyle }))
        );
      }
      let json = this.legacyStyleJson.get(style);
      if (json === void 0) {
        json = utf8Encode(JSON.stringify({ style }));
        this.legacyStyleJson.set(style, json);
      }
      return this.writeProps(id, json);
    }
    /** Read on first use, not at construction: this writer is a module
     * singleton created when host.ts evaluates, and a test or an offline
     * runner may install `__fjsHost` after that. Cached once resolved. */
    get uiOpsVersion() {
      return this.cachedUiOpsVersion || (this.cachedUiOpsVersion = hostUiOpsVersion());
    }
    /** Drops the peer's style directory, so the next use of every style
     * re-sends its definition. The host calls this when it starts recording
     * frames: a frame log has to be self-contained, and definitions emitted
     * before recording began are not in it.
     */
    forgetStyles() {
      if (this.defined.size === 0) return;
      this.defined.clear();
      this.u8(9 /* ResetStyles */);
    }
    writeProps(id, json) {
      this.u8(6 /* SetProps */);
      this.u32(id);
      this.u32(json.length);
      this.bytes(json);
      return this;
    }
    get isEmpty() {
      return this.len === 0;
    }
    reset() {
      this.len = 0;
    }
    toUint8Array() {
      return this.buf.slice(0, this.len);
    }
  };

  // packages/fjs-runtime/src/devtools-hooks.ts
  var devtoolsSlots = {
    provider: null,
    recordProps: () => {
    },
    recordText: () => {
    },
    netRequest: () => {
    },
    netResponse: () => {
    },
    netBodyMaterialized: () => {
    }
  };
  var devtoolsTreeVersion = { value: 0 };
  var devtoolsStructuralVersion = { value: 0 };

  // packages/fjs-runtime/src/host.ts
  var hasNativeHost = typeof globalThis !== "undefined" && "__fjs" in globalThis;
  var _a, _b;
  var host = (_b = (_a = globalThis.__fjs) == null ? void 0 : _a.fns) != null ? _b : null;
  var _a2, _b2;
  var engineInfo = (_b2 = (_a2 = globalThis.__fjs) == null ? void 0 : _a2.engine) != null ? _b2 : {
    engineId: "none",
    abiVersion: 0
  };
  var setTimeout2 = ((cb, ms = 0, ..._a4) => {
    if (!host) return 0;
    return host.setTimeout(wrapHandler(cb), Number(ms) || 0);
  });
  var clearTimeout2 = ((id) => {
    host == null ? void 0 : host.clearTimeout(Number(id) || 0);
  });
  var setInterval = ((cb, ms = 0, ..._a4) => {
    if (!host) return 0;
    return host.setInterval(wrapHandler(cb), Math.max(1, Number(ms) || 1));
  });
  var clearInterval = ((id) => {
    host == null ? void 0 : host.clearInterval(Number(id) || 0);
  });
  function wrapHandler(cb) {
    if (typeof cb === "function") return cb;
    console.warn("[fjs] timer callbacks must be functions (string form unsupported)");
    return () => {
    };
  }
  function invokeHost(name, ...args) {
    if (!host) {
      throw new Error("invokeHost: no native host (running outside fjs runtime)");
    }
    return host.invokeHost(name, ...args);
  }
  function nowMs() {
    return host ? host.nowMs() : Date.now();
  }
  if (hasNativeHost) {
    const g2 = globalThis;
    g2.setTimeout = setTimeout2;
    g2.clearTimeout = clearTimeout2;
    g2.setInterval = setInterval;
    g2.clearInterval = clearInterval;
  }
  var writer = new OpWriter();
  var flushScheduled = false;
  var sink = (frame) => {
    if (host) host.uiOps(frame);
  };
  function setOpSink(s) {
    const previous = sink;
    sink = s;
    return previous;
  }
  function getWriter() {
    return writer;
  }
  if (hasNativeHost) {
    globalThis.__fjsForgetStyles = () => {
      writer.forgetStyles();
      flushNow();
    };
  }
  var preFlush = [];
  function registerPreFlush(fn) {
    preFlush.push(fn);
  }
  function flushNow() {
    flushScheduled = false;
    for (let i = 0; i < preFlush.length; i++) preFlush[i]();
    if (writer.isEmpty) return;
    const frame = writer.toUint8Array();
    writer.reset();
    sink(frame);
    devtoolsTreeVersion.value++;
  }
  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    if (typeof queueMicrotask === "function") {
      queueMicrotask(flushNow);
    } else {
      Promise.resolve().then(flushNow);
    }
  }

  // packages/fjs-runtime/src/canvas/display-list.ts
  var ByteBuf = class {
    constructor() {
      this.buf = new Uint8Array(1024);
      this.len = 0;
    }
    get length() {
      return this.len;
    }
    ensure(n) {
      if (this.len + n <= this.buf.length) return;
      let cap = this.buf.length;
      while (cap < this.len + n) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
    }
    u8(v) {
      this.ensure(1);
      this.buf[this.len++] = v & 255;
      return this;
    }
    u16(v) {
      this.ensure(2);
      this.buf[this.len++] = v & 255;
      this.buf[this.len++] = v >>> 8 & 255;
      return this;
    }
    u32(v) {
      this.ensure(4);
      const b = this.buf;
      let p = this.len;
      b[p++] = v & 255;
      b[p++] = v >>> 8 & 255;
      b[p++] = v >>> 16 & 255;
      b[p++] = v >>> 24 & 255;
      this.len = p;
      return this;
    }
    /** Signed 32-bit, little-endian. Same wire shape as u32 (two's complement);
     * the decoder reads with getUint32 and reinterprets. */
    i32(v) {
      return this.u32(v | 0);
    }
    f32(v) {
      this.ensure(4);
      f32View[0] = v;
      const b = this.buf;
      b[this.len++] = f32Bytes[0];
      b[this.len++] = f32Bytes[1];
      b[this.len++] = f32Bytes[2];
      b[this.len++] = f32Bytes[3];
      return this;
    }
    bytes(src) {
      this.ensure(src.length);
      this.buf.set(src, this.len);
      this.len += src.length;
      return this;
    }
    /** The bytes so far, leaving them in place. */
    peek() {
      return this.buf.slice(0, this.len);
    }
    take() {
      const out = this.buf.slice(0, this.len);
      this.len = 0;
      return out;
    }
    reset() {
      this.len = 0;
    }
  };
  var f32Scratch = new ArrayBuffer(4);
  var f32View = new Float32Array(f32Scratch);
  var f32Bytes = new Uint8Array(f32Scratch);
  var CanvasWriter = class {
    constructor(onDirty) {
      this.onDirty = onDirty;
      this.buf = new ByteBuf();
      /** Chunks completed but not yet handed to the op frame. */
      this.pending = [];
      /** Per-chunk string table. Cleared whenever a chunk is closed. */
      this.strings = /* @__PURE__ */ new Map();
      this.nextStringId = 1;
      /** Sticky: once a canvas has erased part of itself it keeps the marker on
       * every later chunk, so a truncation that drops the chunk carrying it
       * cannot lose the flag. */
      this.layerNeeded = false;
    }
    /** Interns a string in the current chunk, emitting its definition once. */
    str(value) {
      const known = this.strings.get(value);
      if (known !== void 0) return known;
      const id = this.nextStringId++;
      this.strings.set(value, id);
      const encoded = utf8Encode(value);
      this.buf.u8(1 /* StrDef */);
      this.buf.u16(id);
      this.buf.u16(encoded.length);
      this.buf.bytes(encoded);
      return id;
    }
    /** Starts a command. Callers follow with the argument writers below. */
    cmd(c) {
      this.buf.u8(c);
      this.onDirty();
      return this.buf;
    }
    /** This canvas has erased part of itself, which only means "make those
     * pixels transparent" if the replay owns the surface it is erasing from.
     * The host draws straight into the widget layer, where a clear would punch
     * a hole through everything under the canvas box, so it needs a layer —
     * and it has to know BEFORE it replays the first command, which is why
     * this rides at the head of every chunk from here on rather than inline
     * with the clearRect that caused it. */
    markNeedsLayer() {
      if (hostUiOpsVersion() >= 4) this.layerNeeded = true;
    }
    /** Everything drawn so far is now invisible: close this chunk and open the
     * next one with the marker the host truncates on. */
    clearAll() {
      this.closeChunk();
      this.buf.u8(58 /* ClearAll */);
      this.onDirty();
    }
    closeChunk() {
      if (this.buf.length > 0) {
        const bytes = this.buf.take();
        this.pending.push(this.layerNeeded ? withNeedsLayer(bytes) : bytes);
      }
      this.strings.clear();
      this.nextStringId = 1;
    }
    /** Hands over the chunks to send, oldest first. */
    takeChunks() {
      this.closeChunk();
      const out = this.pending;
      this.pending = [];
      return out;
    }
    get isEmpty() {
      return this.buf.length === 0 && this.pending.length === 0;
    }
  };
  function withNeedsLayer(bytes) {
    const out = new Uint8Array(bytes.length + 1);
    out[0] = 59 /* NeedsLayer */;
    out.set(bytes, 1);
    return out;
  }

  // packages/fjs-runtime/src/canvas/warn.ts
  var warned = /* @__PURE__ */ new Set();
  function warnCanvasOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[fjs] ${message}`);
  }

  // packages/fjs-runtime/src/canvas/font.ts
  var DEFAULT_FONT = {
    size: 10,
    weight: 400,
    italic: false,
    family: "sans-serif"
  };
  var NAMED_WEIGHT = {
    normal: 400,
    bold: 700,
    bolder: 700,
    lighter: 300
  };
  function parseFont(value) {
    const text = value.trim();
    if (text === "") return null;
    let italic = false;
    let weight = 400;
    let size = 0;
    let family = "";
    const parts = text.split(/\s+/);
    for (let i = 0; i < parts.length; i++) {
      const token = parts[i];
      if (size === 0) {
        const lower = token.toLowerCase();
        if (lower === "italic" || lower === "oblique") {
          italic = true;
          continue;
        }
        if (lower === "normal") continue;
        if (lower === "small-caps") continue;
        if (lower in NAMED_WEIGHT) {
          weight = NAMED_WEIGHT[lower];
          continue;
        }
        const numeric = Number(token);
        if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 1e3 && !/px$/i.test(token)) {
          weight = numeric;
          continue;
        }
        const px = /^(\d*\.?\d+)px$/i.exec(token);
        if (px) {
          size = Number(px[1]);
          family = parts.slice(i + 1).join(" ");
          break;
        }
        return null;
      }
    }
    if (size <= 0) return null;
    return {
      size,
      weight,
      italic,
      family: normalizeFamily(family)
    };
  }
  function normalizeFamily(list) {
    var _a4, _b3;
    const first = (_b3 = (_a4 = list.split(",")[0]) == null ? void 0 : _a4.trim()) != null ? _b3 : "";
    const unquoted = first.replace(/^['"]|['"]$/g, "").trim();
    return unquoted === "" ? DEFAULT_FONT.family : unquoted;
  }
  function parseFontOrWarn(value, current) {
    const parsed = parseFont(value);
    if (parsed) return parsed;
    warnCanvasOnce(
      `font:${value}`,
      `<canvas> font "${value}" is not supported; fjs parses "[style] [weight] <size>px [family]" (see docs/canvas-compat.md). Keeping the previous font.`
    );
    return current;
  }
  function fontJson(font) {
    return JSON.stringify({
      size: font.size,
      weight: font.weight,
      italic: font.italic,
      family: font.family
    });
  }

  // packages/fjs-runtime/src/canvas/image.ts
  var CANVAS_EVENT = 30;
  var sizeListeners = /* @__PURE__ */ new Map();
  var imageRequests = /* @__PURE__ */ new Map();
  var dataUrlRequests = /* @__PURE__ */ new Map();
  var nextHandle = 1;
  var installed = false;
  var registrar = null;
  function setCanvasEventRegistrar(register) {
    registrar = register;
  }
  function listenCanvasSize(nodeId, listener) {
    install();
    sizeListeners.set(nodeId, listener);
  }
  function forgetCanvasSize(nodeId) {
    sizeListeners.delete(nodeId);
  }
  function install() {
    if (installed || !registrar) return;
    installed = true;
    registrar(CANVAS_EVENT, (id, payload) => {
      var _a4, _b3, _c, _d, _e, _f;
      if (!payload) return;
      let message;
      try {
        message = JSON.parse(payload);
      } catch {
        return;
      }
      switch (message.t) {
        case "size":
          (_c = sizeListeners.get(id)) == null ? void 0 : _c(
            (_a4 = message.w) != null ? _a4 : 0,
            (_b3 = message.h) != null ? _b3 : 0,
            message.dpr
          );
          return;
        case "image": {
          const image = imageRequests.get(id);
          if (!image) return;
          imageRequests.delete(id);
          image._settle((_d = message.w) != null ? _d : 0, (_e = message.h) != null ? _e : 0, message.err);
          return;
        }
        case "dataurl": {
          const resolve = dataUrlRequests.get(id);
          if (!resolve) return;
          dataUrlRequests.delete(id);
          resolve((_f = message.data) != null ? _f : "", message.err);
          return;
        }
        default:
          return;
      }
    });
  }
  var FjsCanvasImage = class {
    constructor() {
      this.handle = nextHandle++;
      this.width = 0;
      this.height = 0;
      this.complete = false;
      this.onload = null;
      this.onerror = null;
      this._src = "";
    }
    get src() {
      return this._src;
    }
    set src(value) {
      this._src = value;
      if (value === "") return;
      install();
      imageRequests.set(this.handle, this);
      try {
        invokeHost("fjs.canvas.loadImage", this.handle, value);
      } catch {
        imageRequests.delete(this.handle);
        this._settle(0, 0, "no native host");
      }
    }
    /** @internal — called by the dispatcher above. */
    _settle(width, height, error) {
      var _a4, _b3;
      this.complete = true;
      if (error) {
        (_a4 = this.onerror) == null ? void 0 : _a4.call(this, error);
        return;
      }
      this.width = width;
      this.height = height;
      (_b3 = this.onload) == null ? void 0 : _b3.call(this);
    }
  };
  var nextDataUrlRequest = 1;
  function canvasToDataURL(nodeId, type = "image/png", quality = 0.92) {
    install();
    const id = nextDataUrlRequest++;
    return new Promise((resolve, reject) => {
      dataUrlRequests.set(id, (data, error) => {
        if (error) reject(new Error(error));
        else resolve(data);
      });
      try {
        invokeHost("fjs.canvas.toDataURL", id, nodeId, type, quality);
      } catch {
        dataUrlRequests.delete(id);
        warnCanvasOnce(
          "todataurl-no-host",
          "canvas.toDataURL() needs the native host; nothing to export."
        );
        reject(new Error("no native host"));
      }
    });
  }

  // packages/fjs-runtime/src/canvas/measure.ts
  var CACHE_MAX = 2048;
  var cache = /* @__PURE__ */ new Map();
  function measureTextOnHost(font, text) {
    const json = fontJson(font);
    const key = `${json} ${text}`;
    const hit = cache.get(key);
    if (hit !== void 0) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    let metrics = { width: 0 };
    try {
      const raw = invokeHost("fjs.canvas.measureText", json, text);
      if (typeof raw === "string" && raw !== "") {
        metrics = JSON.parse(raw);
      }
    } catch {
      metrics = { width: 0 };
    }
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, metrics);
    return metrics;
  }

  // packages/fjs-runtime/src/canvas/paint-style.ts
  var nextHandle2 = 1;
  var FjsCanvasGradient = class {
    constructor(radial, geometry) {
      this.radial = radial;
      this.geometry = geometry;
      this.handle = nextHandle2++;
      this.stops = [];
      /** Writers this definition has already been sent to. A gradient can be
       * used by more than one canvas, and each host-side canvas keeps its own
       * resource table. */
      this.defined = /* @__PURE__ */ new WeakSet();
    }
    addColorStop(offset, color) {
      if (!Number.isFinite(offset)) return;
      this.stops.push({ offset, color });
    }
    /** Emits the definition into [writer] if it has not seen it yet. */
    define(writer2) {
      if (this.defined.has(writer2)) return;
      this.defined.add(writer2);
      if (this.stops.length === 0) {
        warnCanvasOnce(
          "gradient-no-stops",
          "a canvas gradient was used with no color stops; nothing will be painted with it."
        );
      }
      const ids = this.stops.map((stop) => writer2.str(stop.color));
      const buf = writer2.cmd(
        this.radial ? 65 /* DefRadialGradient */ : 64 /* DefLinearGradient */
      );
      buf.u32(this.handle);
      for (const value of this.geometry) buf.f32(value);
      buf.u8(Math.min(this.stops.length, 255));
      for (let i = 0; i < this.stops.length && i < 255; i++) {
        buf.f32(this.stops[i].offset);
        buf.u16(ids[i]);
      }
    }
  };
  var FjsCanvasPattern = class {
    constructor(imageHandle, repeat) {
      this.imageHandle = imageHandle;
      this.repeat = repeat;
      this.handle = nextHandle2++;
      this.defined = /* @__PURE__ */ new WeakSet();
    }
    define(writer2) {
      if (this.defined.has(writer2)) return;
      this.defined.add(writer2);
      const buf = writer2.cmd(66 /* DefPattern */);
      buf.u32(this.handle);
      buf.u32(this.imageHandle);
      buf.u8(this.repeat);
    }
  };
  function patternRepeat(value) {
    switch (value) {
      case "repeat-x":
        return 1 /* RepeatX */;
      case "repeat-y":
        return 2 /* RepeatY */;
      case "no-repeat":
        return 3 /* NoRepeat */;
      default:
        return 0 /* Repeat */;
    }
  }

  // packages/fjs-runtime/src/canvas/path2d.ts
  var FjsPath2D = class {
    constructor(source) {
      /** Encoded path commands. */
      this.buf = new ByteBuf();
      /** Where the current subpath started, for closePath and for arc's implicit
       * line. Null when there is no current point. */
      this.startX = 0;
      this.startY = 0;
      this.hasStart = false;
      this.lastX = 0;
      this.lastY = 0;
      if (typeof source === "string") {
        warnCanvasOnce(
          "path2d-svg",
          "new Path2D(<svg string>) is not supported; build the path with moveTo/lineTo/arc instead (see docs/canvas-compat.md)."
        );
        return;
      }
      if (source) this.addPath(source);
    }
    get isEmpty() {
      return this.buf.length === 0;
    }
    get currentX() {
      return this.lastX;
    }
    get currentY() {
      return this.lastY;
    }
    get hasCurrentPoint() {
      return this.hasStart;
    }
    addPath(other) {
      if (other.buf.length === 0) return;
      this.buf.bytes(other.snapshot());
      this.hasStart = other.hasStart;
      this.lastX = other.lastX;
      this.lastY = other.lastY;
      this.startX = other.startX;
      this.startY = other.startY;
    }
    /** The bytes so far, without consuming them (unlike ByteBuf.take). */
    snapshot() {
      return this.buf.peek();
    }
    moveTo(x, y) {
      this.buf.u8(1 /* MoveTo */);
      this.buf.f32(x);
      this.buf.f32(y);
      this.startX = x;
      this.startY = y;
      this.hasStart = true;
      this.lastX = x;
      this.lastY = y;
    }
    lineTo(x, y) {
      if (!this.hasStart) return this.moveTo(x, y);
      this.buf.u8(2 /* LineTo */);
      this.buf.f32(x);
      this.buf.f32(y);
      this.lastX = x;
      this.lastY = y;
    }
    bezierCurveTo(x1, y1, x2, y2, x, y) {
      if (!this.hasStart) this.moveTo(x1, y1);
      this.buf.u8(3 /* CubicTo */);
      this.buf.f32(x1);
      this.buf.f32(y1);
      this.buf.f32(x2);
      this.buf.f32(y2);
      this.buf.f32(x);
      this.buf.f32(y);
      this.lastX = x;
      this.lastY = y;
    }
    quadraticCurveTo(x1, y1, x, y) {
      if (!this.hasStart) this.moveTo(x1, y1);
      this.buf.u8(4 /* QuadTo */);
      this.buf.f32(x1);
      this.buf.f32(y1);
      this.buf.f32(x);
      this.buf.f32(y);
      this.lastX = x;
      this.lastY = y;
    }
    arc(x, y, radius, startAngle, endAngle, counterclockwise = false) {
      this.buf.u8(5 /* Arc */);
      this.buf.f32(x);
      this.buf.f32(y);
      this.buf.f32(radius);
      this.buf.f32(startAngle);
      this.buf.f32(endAngle);
      this.buf.u8(counterclockwise ? 1 : 0);
      this.hasStart = true;
      this.lastX = x + radius * Math.cos(endAngle);
      this.lastY = y + radius * Math.sin(endAngle);
    }
    /** DOM `arcTo` is a **corner fillet**: the arc is tangent to the segment
     *  coming in from the current point and to the one going out towards
     *  (x2, y2), and it ENDS AT THE TANGENT POINT — not at (x2, y2), which is
     *  only ever a direction. That is why it is lowered here instead of being
     *  sent as its own command: Flutter has no fillet, only `arcToPoint` (the
     *  SVG arc), whose end point IS the point you hand it, so the two draw
     *  completely different curves — a rounded rectangle came out as a barrel,
     *  with each corner bulging across a whole side.
     *
     *  The tangent points are plain trigonometry and the same on both ends, so
     *  computing them here leaves the host with `lineTo` + `arc`, two commands
     *  it already agrees with the browser about. (HTML spec, "arcTo".) */
    arcTo(x1, y1, x2, y2, radius) {
      if (!(radius >= 0)) {
        throw new RangeError(`arcTo: radius must be >= 0, got ${radius}`);
      }
      if (!this.hasStart) {
        this.moveTo(x1, y1);
        return;
      }
      const inX = this.lastX - x1;
      const inY = this.lastY - y1;
      const outX = x2 - x1;
      const outY = y2 - y1;
      const inLen = Math.hypot(inX, inY);
      const outLen = Math.hypot(outX, outY);
      if (inLen === 0 || outLen === 0 || radius === 0) {
        this.lineTo(x1, y1);
        return;
      }
      const ux = inX / inLen;
      const uy = inY / inLen;
      const vx = outX / outLen;
      const vy = outY / outLen;
      const cross = ux * vy - uy * vx;
      if (Math.abs(cross) < 1e-9) {
        this.lineTo(x1, y1);
        return;
      }
      const dot = Math.min(1, Math.max(-1, ux * vx + uy * vy));
      const half = Math.acos(dot) / 2;
      const along = radius / Math.tan(half);
      const toCentre = radius / Math.sin(half);
      const startX = x1 + ux * along;
      const startY = y1 + uy * along;
      const endX = x1 + vx * along;
      const endY = y1 + vy * along;
      const bisectorX = ux + vx;
      const bisectorY = uy + vy;
      const bisectorLen = Math.hypot(bisectorX, bisectorY);
      const cx = x1 + bisectorX / bisectorLen * toCentre;
      const cy = y1 + bisectorY / bisectorLen * toCentre;
      this.lineTo(startX, startY);
      this.arc(
        cx,
        cy,
        radius,
        Math.atan2(startY - cy, startX - cx),
        Math.atan2(endY - cy, endX - cx),
        // y grows downward, so a right turn (cross < 0) is the one that sweeps
        // with increasing angle — which is what canvas calls clockwise
        cross > 0
      );
    }
    ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise = false) {
      this.buf.u8(7 /* Ellipse */);
      this.buf.f32(x);
      this.buf.f32(y);
      this.buf.f32(radiusX);
      this.buf.f32(radiusY);
      this.buf.f32(rotation);
      this.buf.f32(startAngle);
      this.buf.f32(endAngle);
      this.buf.u8(counterclockwise ? 1 : 0);
      this.hasStart = true;
      this.lastX = x + radiusX * Math.cos(endAngle);
      this.lastY = y + radiusY * Math.sin(endAngle);
    }
    rect(x, y, w, h2) {
      this.buf.u8(8 /* Rect */);
      this.buf.f32(x);
      this.buf.f32(y);
      this.buf.f32(w);
      this.buf.f32(h2);
      this.startX = x;
      this.startY = y;
      this.hasStart = true;
      this.lastX = x;
      this.lastY = y;
    }
    roundRect() {
      warnCanvasOnce(
        "roundRect",
        "ctx.roundRect() is not supported; build the corners with arcTo (see docs/canvas-compat.md)."
      );
    }
    closePath() {
      if (!this.hasStart) return;
      this.buf.u8(9 /* Close */);
      this.lastX = this.startX;
      this.lastY = this.startY;
    }
    reset() {
      this.buf.reset();
      this.hasStart = false;
      this.lastX = 0;
      this.lastY = 0;
    }
  };

  // packages/fjs-runtime/src/canvas/context-2d.ts
  var LINE_CAP = { butt: 0, round: 1, square: 2 };
  var LINE_JOIN = { miter: 0, round: 1, bevel: 2 };
  var TEXT_ALIGN = { start: 0, end: 1, left: 2, right: 3, center: 4 };
  var TEXT_BASELINE = {
    top: 0,
    hanging: 1,
    middle: 2,
    alphabetic: 3,
    ideographic: 4,
    bottom: 5
  };
  var COMPOSITE = {
    "source-over": 0,
    "source-in": 1,
    "source-out": 2,
    "source-atop": 3,
    "destination-over": 4,
    "destination-in": 5,
    "destination-out": 6,
    "destination-atop": 7,
    lighter: 8,
    copy: 9,
    xor: 10,
    multiply: 11,
    screen: 12,
    overlay: 13,
    darken: 14,
    lighten: 15,
    "color-dodge": 16,
    "color-burn": 17,
    "hard-light": 18,
    "soft-light": 19,
    difference: 20,
    exclusion: 21,
    hue: 22,
    saturation: 23,
    color: 24,
    luminosity: 25
  };
  function initialState() {
    return {
      fillStyle: "#000000",
      strokeStyle: "#000000",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      miterLimit: 10,
      lineDash: [],
      lineDashOffset: 0,
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      font: DEFAULT_FONT,
      fontSource: "10px sans-serif",
      textAlign: "start",
      textBaseline: "alphabetic",
      shadowColor: "rgba(0, 0, 0, 0)",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      matrix: [1, 0, 0, 1, 0, 0]
    };
  }
  function multiply(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5]
    ];
  }
  var FjsCanvasRenderingContext2D = class {
    constructor(surface, canvas) {
      this.state = initialState();
      this.stack = [];
      /** What the host currently has. Only differences are sent. */
      this.sent = initialState();
      this.path = new FjsPath2D();
      this.sentStack = [];
      this.surface = surface;
      this.canvas = canvas;
    }
    // ---- state -------------------------------------------------------------
    save() {
      this.stack.push({ ...this.state, lineDash: [...this.state.lineDash], matrix: [...this.state.matrix] });
      this.surface.writer.cmd(16 /* Save */);
      this.sentStack.push({ ...this.sent, lineDash: [...this.sent.lineDash], matrix: [...this.sent.matrix] });
    }
    restore() {
      const previous = this.stack.pop();
      if (!previous) return;
      this.state = previous;
      this.surface.writer.cmd(17 /* Restore */);
      const sent2 = this.sentStack.pop();
      if (sent2) this.sent = sent2;
    }
    reset() {
      this.state = initialState();
      this.stack.length = 0;
      this.path = new FjsPath2D();
      this.surface.writer.clearAll();
      this.afterChunkBoundary();
    }
    /** A CLEAR_ALL opens a new chunk and lets the host drop every chunk before
     * it — including the commands that put the host in its current state. So a
     * chunk has to be self-contained in STATE as well as in strings: the
     * dedup baseline goes back to the defaults the host starts a chunk from,
     * and every property the page has set will be re-sent before the next
     * draw that needs it.
     *
     * Getting this wrong is invisible until it isn't: a chart that sets its
     * colours once and then clears every frame would paint the first frame
     * correctly and every later one in black. */
    afterChunkBoundary() {
      this.sent = initialState();
      this.sentStack.length = 0;
      for (let i = 0; i < this.stack.length; i++) {
        this.surface.writer.cmd(16 /* Save */);
        this.sentStack.push(initialState());
      }
      const m = this.state.matrix;
      if (m[0] !== 1 || m[1] !== 0 || m[2] !== 0 || m[3] !== 1 || m[4] !== 0 || m[5] !== 0) {
        const buf = this.surface.writer.cmd(19 /* SetTransform */);
        for (let i = 0; i < 6; i++) buf.f32(m[i]);
      }
    }
    // ---- transforms --------------------------------------------------------
    scale(x, y) {
      this.transform(x, 0, 0, y, 0, 0);
    }
    rotate(angle) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      this.transform(cos, sin, -sin, cos, 0, 0);
    }
    translate(x, y) {
      this.transform(1, 0, 0, 1, x, y);
    }
    transform(a, b, c, d, e, f) {
      this.state.matrix = multiply(this.state.matrix, [a, b, c, d, e, f]);
      const buf = this.surface.writer.cmd(18 /* Transform */);
      buf.f32(a);
      buf.f32(b);
      buf.f32(c);
      buf.f32(d);
      buf.f32(e);
      buf.f32(f);
    }
    setTransform(a, b, c, d, e, f) {
      this.state.matrix = [a, b, c, d, e, f];
      const buf = this.surface.writer.cmd(19 /* SetTransform */);
      buf.f32(a);
      buf.f32(b);
      buf.f32(c);
      buf.f32(d);
      buf.f32(e);
      buf.f32(f);
    }
    resetTransform() {
      this.state.matrix = [1, 0, 0, 1, 0, 0];
      this.surface.writer.cmd(20 /* ResetTransform */);
    }
    getTransform() {
      const [a, b, c, d, e, f] = this.state.matrix;
      return { a, b, c, d, e, f };
    }
    // ---- style properties --------------------------------------------------
    get fillStyle() {
      return this.state.fillStyle;
    }
    set fillStyle(value) {
      this.state.fillStyle = value;
    }
    get strokeStyle() {
      return this.state.strokeStyle;
    }
    set strokeStyle(value) {
      this.state.strokeStyle = value;
    }
    get lineWidth() {
      return this.state.lineWidth;
    }
    set lineWidth(value) {
      if (Number.isFinite(value) && value > 0) this.state.lineWidth = value;
    }
    get lineCap() {
      return this.state.lineCap;
    }
    set lineCap(value) {
      if (value in LINE_CAP) this.state.lineCap = value;
    }
    get lineJoin() {
      return this.state.lineJoin;
    }
    set lineJoin(value) {
      if (value in LINE_JOIN) this.state.lineJoin = value;
    }
    get miterLimit() {
      return this.state.miterLimit;
    }
    set miterLimit(value) {
      if (Number.isFinite(value) && value > 0) this.state.miterLimit = value;
    }
    setLineDash(segments) {
      const clean = segments.filter((n) => Number.isFinite(n) && n >= 0);
      this.state.lineDash = clean.length % 2 === 1 ? [...clean, ...clean] : clean;
    }
    getLineDash() {
      return [...this.state.lineDash];
    }
    get lineDashOffset() {
      return this.state.lineDashOffset;
    }
    set lineDashOffset(value) {
      if (Number.isFinite(value)) this.state.lineDashOffset = value;
    }
    get globalAlpha() {
      return this.state.globalAlpha;
    }
    set globalAlpha(value) {
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        this.state.globalAlpha = value;
      }
    }
    get globalCompositeOperation() {
      return this.state.globalCompositeOperation;
    }
    set globalCompositeOperation(value) {
      if (value in COMPOSITE) {
        this.state.globalCompositeOperation = value;
        return;
      }
      warnCanvasOnce(
        `composite:${value}`,
        `globalCompositeOperation "${value}" is not supported; keeping "${this.state.globalCompositeOperation}".`
      );
    }
    get font() {
      return this.state.fontSource;
    }
    set font(value) {
      const parsed = parseFontOrWarn(value, this.state.font);
      this.state.font = parsed;
      this.state.fontSource = value;
    }
    get textAlign() {
      return this.state.textAlign;
    }
    set textAlign(value) {
      if (value in TEXT_ALIGN) this.state.textAlign = value;
    }
    get textBaseline() {
      return this.state.textBaseline;
    }
    set textBaseline(value) {
      if (value in TEXT_BASELINE) {
        this.state.textBaseline = value;
      }
    }
    get shadowColor() {
      return this.state.shadowColor;
    }
    set shadowColor(value) {
      this.state.shadowColor = value;
    }
    get shadowBlur() {
      return this.state.shadowBlur;
    }
    set shadowBlur(value) {
      if (Number.isFinite(value) && value >= 0) this.state.shadowBlur = value;
    }
    get shadowOffsetX() {
      return this.state.shadowOffsetX;
    }
    set shadowOffsetX(value) {
      if (Number.isFinite(value)) this.state.shadowOffsetX = value;
    }
    get shadowOffsetY() {
      return this.state.shadowOffsetY;
    }
    set shadowOffsetY(value) {
      if (Number.isFinite(value)) this.state.shadowOffsetY = value;
    }
    /** `filter` needs a CSS filter parser and a shader chain per value; out of
     * scope (spec §2). Warned rather than dropped so a page that relies on it
     * finds out here instead of by comparing screenshots. */
    set filter(value) {
      if (value === "none" || value === "") return;
      warnCanvasOnce(
        "filter",
        "ctx.filter is not supported (see docs/canvas-compat.md)."
      );
    }
    get filter() {
      return "none";
    }
    // ---- paint styles ------------------------------------------------------
    createLinearGradient(x0, y0, x1, y1) {
      return new FjsCanvasGradient(false, [x0, y0, x1, y1]);
    }
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      return new FjsCanvasGradient(true, [x0, y0, r0, x1, y1, r1]);
    }
    createPattern(image, repetition) {
      if (!(image instanceof FjsCanvasImage)) {
        warnCanvasOnce(
          "pattern-source",
          "createPattern() takes an image loaded through this canvas; other sources are not supported."
        );
        return null;
      }
      return new FjsCanvasPattern(image.handle, patternRepeat(repetition));
    }
    // ---- paths -------------------------------------------------------------
    beginPath() {
      this.path = new FjsPath2D();
    }
    closePath() {
      this.path.closePath();
    }
    moveTo(x, y) {
      this.path.moveTo(x, y);
    }
    lineTo(x, y) {
      this.path.lineTo(x, y);
    }
    bezierCurveTo(x1, y1, x2, y2, x, y) {
      this.path.bezierCurveTo(x1, y1, x2, y2, x, y);
    }
    quadraticCurveTo(x1, y1, x, y) {
      this.path.quadraticCurveTo(x1, y1, x, y);
    }
    arc(x, y, radius, startAngle, endAngle, counterclockwise) {
      this.path.arc(x, y, radius, startAngle, endAngle, counterclockwise);
    }
    arcTo(x1, y1, x2, y2, radius) {
      this.path.arcTo(x1, y1, x2, y2, radius);
    }
    ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise) {
      this.path.ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise);
    }
    rect(x, y, w, h2) {
      this.path.rect(x, y, w, h2);
    }
    roundRect() {
      this.path.roundRect();
    }
    // ---- drawing -----------------------------------------------------------
    clearRect(x, y, w, h2) {
      if (this.coversCanvas(x, y, w, h2)) {
        this.surface.writer.clearAll();
        this.afterChunkBoundary();
        return;
      }
      this.surface.writer.markNeedsLayer();
      const buf = this.surface.writer.cmd(48 /* ClearRect */);
      buf.f32(x);
      buf.f32(y);
      buf.f32(w);
      buf.f32(h2);
    }
    /** True when this rect, under the current transform, covers the whole
     * canvas. Only the axis-aligned case is recognised: a rotated clear is
     * legal but nothing draws one, and being wrong here would drop commands
     * that are still visible. */
    coversCanvas(x, y, w, h2) {
      const width = this.surface.width();
      const height = this.surface.height();
      if (width <= 0 || height <= 0) return false;
      const [a, b, c, d, e, f] = this.state.matrix;
      if (b !== 0 || c !== 0 || a <= 0 || d <= 0) return false;
      const left = a * x + e;
      const top = d * y + f;
      return left <= 0 && top <= 0 && left + a * w >= width && top + d * h2 >= height;
    }
    fillRect(x, y, w, h2) {
      this.syncFill();
      const buf = this.surface.writer.cmd(49 /* FillRect */);
      buf.f32(x);
      buf.f32(y);
      buf.f32(w);
      buf.f32(h2);
    }
    strokeRect(x, y, w, h2) {
      this.syncStroke();
      const buf = this.surface.writer.cmd(50 /* StrokeRect */);
      buf.f32(x);
      buf.f32(y);
      buf.f32(w);
      buf.f32(h2);
    }
    fill(pathOrRule, maybeRule) {
      const path = pathOrRule instanceof FjsPath2D ? pathOrRule : this.path;
      const rule = typeof pathOrRule === "string" ? pathOrRule : maybeRule;
      if (path.isEmpty) return;
      this.syncFill();
      const bytes = path.snapshot();
      const buf = this.surface.writer.cmd(51 /* FillPath */);
      buf.u8(rule === "evenodd" ? 1 : 0);
      buf.u32(bytes.length);
      buf.bytes(bytes);
    }
    stroke(path) {
      const target = path != null ? path : this.path;
      if (target.isEmpty) return;
      this.syncStroke();
      const bytes = target.snapshot();
      const buf = this.surface.writer.cmd(52 /* StrokePath */);
      buf.u32(bytes.length);
      buf.bytes(bytes);
    }
    clip(pathOrRule, maybeRule) {
      const path = pathOrRule instanceof FjsPath2D ? pathOrRule : this.path;
      const rule = typeof pathOrRule === "string" ? pathOrRule : maybeRule;
      if (path.isEmpty) return;
      const bytes = path.snapshot();
      const buf = this.surface.writer.cmd(53 /* ClipPath */);
      buf.u8(rule === "evenodd" ? 1 : 0);
      buf.u32(bytes.length);
      buf.bytes(bytes);
    }
    fillText(text, x, y, maxWidth) {
      this.drawText(54 /* FillText */, text, x, y, maxWidth, true);
    }
    strokeText(text, x, y, maxWidth) {
      this.drawText(55 /* StrokeText */, text, x, y, maxWidth, false);
    }
    drawText(cmd2, rawText, x, y, maxWidth, fill) {
      const text = drawableText(rawText);
      if (text === "") return;
      if (fill) this.syncFill();
      else this.syncStroke();
      this.syncText();
      const id = this.surface.writer.str(text);
      const buf = this.surface.writer.cmd(cmd2);
      buf.u16(id);
      buf.f32(x);
      buf.f32(y);
      buf.u8(maxWidth === void 0 ? 0 : 1);
      buf.f32(maxWidth != null ? maxWidth : 0);
    }
    measureText(text) {
      return measureTextOnHost(this.state.font, drawableText(text));
    }
    drawImage(image, ...args) {
      var _a4;
      if (!(image instanceof FjsCanvasImage)) {
        warnCanvasOnce(
          "drawimage-source",
          "drawImage() takes an image loaded through this canvas; other sources (a second canvas, a video) are not supported."
        );
        return;
      }
      const form = args.length >= 8 ? 9 /* SrcDstRect */ : args.length >= 4 ? 5 /* DstRect */ : 3 /* DstPoint */;
      this.syncCommon();
      const buf = this.surface.writer.cmd(56 /* DrawImage */);
      buf.u32(image.handle);
      buf.u8(form);
      const count = form === 9 /* SrcDstRect */ ? 8 : form === 5 /* DstRect */ ? 4 : 2;
      for (let i = 0; i < count; i++) buf.f32((_a4 = args[i]) != null ? _a4 : 0);
    }
    /** Pixel read-back. `toDataURL` on the element is the supported export
     * path; these need the bitmap in JS, which the boundary does not carry
     * (spec §7.1). */
    getImageData() {
      warnCanvasOnce(
        "getImageData",
        "getImageData() is not supported; use canvas.toDataURL() to export the whole canvas (see docs/canvas-compat.md)."
      );
      return null;
    }
    putImageData() {
      warnCanvasOnce(
        "putImageData",
        "putImageData() is not supported (see docs/canvas-compat.md)."
      );
    }
    createImageData() {
      warnCanvasOnce(
        "createImageData",
        "createImageData() is not supported (see docs/canvas-compat.md)."
      );
      return null;
    }
    isPointInPath() {
      warnCanvasOnce(
        "isPointInPath",
        "isPointInPath() is not supported; hit-test in page code against the geometry you drew (see docs/canvas-compat.md)."
      );
      return false;
    }
    isPointInStroke() {
      warnCanvasOnce(
        "isPointInStroke",
        "isPointInStroke() is not supported (see docs/canvas-compat.md)."
      );
      return false;
    }
    // ---- state synchronisation --------------------------------------------
    //
    // Sent lazily, just before a draw, and only for what changed. A chart sets
    // the same fillStyle before every one of a thousand bars; sending on
    // assignment would put a thousand redundant commands in the frame.
    syncCommon() {
      var _a4;
      const state = this.state;
      const sent2 = this.sent;
      if (state.globalAlpha !== sent2.globalAlpha) {
        this.surface.writer.cmd(42 /* SetGlobalAlpha */).f32(state.globalAlpha);
        sent2.globalAlpha = state.globalAlpha;
      }
      if (state.globalCompositeOperation !== sent2.globalCompositeOperation) {
        this.surface.writer.cmd(43 /* SetComposite */).u8((_a4 = COMPOSITE[state.globalCompositeOperation]) != null ? _a4 : 0);
        sent2.globalCompositeOperation = state.globalCompositeOperation;
      }
      const shadowChanged = state.shadowColor !== sent2.shadowColor || state.shadowBlur !== sent2.shadowBlur || state.shadowOffsetX !== sent2.shadowOffsetX || state.shadowOffsetY !== sent2.shadowOffsetY;
      if (shadowChanged) {
        const id = this.surface.writer.str(state.shadowColor);
        const buf = this.surface.writer.cmd(47 /* SetShadow */);
        buf.u16(id);
        buf.f32(state.shadowBlur);
        buf.f32(state.shadowOffsetX);
        buf.f32(state.shadowOffsetY);
        sent2.shadowColor = state.shadowColor;
        sent2.shadowBlur = state.shadowBlur;
        sent2.shadowOffsetX = state.shadowOffsetX;
        sent2.shadowOffsetY = state.shadowOffsetY;
      }
    }
    syncFill() {
      this.syncCommon();
      if (this.state.fillStyle === this.sent.fillStyle) return;
      this.writeStyle(this.state.fillStyle, 32 /* SetFillColor */, 33 /* SetFillHandle */);
      this.sent.fillStyle = this.state.fillStyle;
    }
    syncStroke() {
      this.syncCommon();
      const state = this.state;
      const sent2 = this.sent;
      if (state.strokeStyle !== sent2.strokeStyle) {
        this.writeStyle(state.strokeStyle, 34 /* SetStrokeColor */, 35 /* SetStrokeHandle */);
        sent2.strokeStyle = state.strokeStyle;
      }
      if (state.lineWidth !== sent2.lineWidth) {
        this.surface.writer.cmd(36 /* SetLineWidth */).f32(state.lineWidth);
        sent2.lineWidth = state.lineWidth;
      }
      if (state.lineCap !== sent2.lineCap) {
        this.surface.writer.cmd(37 /* SetLineCap */).u8(LINE_CAP[state.lineCap]);
        sent2.lineCap = state.lineCap;
      }
      if (state.lineJoin !== sent2.lineJoin) {
        this.surface.writer.cmd(38 /* SetLineJoin */).u8(LINE_JOIN[state.lineJoin]);
        sent2.lineJoin = state.lineJoin;
      }
      if (state.miterLimit !== sent2.miterLimit) {
        this.surface.writer.cmd(39 /* SetMiterLimit */).f32(state.miterLimit);
        sent2.miterLimit = state.miterLimit;
      }
      if (!sameDash(state.lineDash, sent2.lineDash)) {
        const buf = this.surface.writer.cmd(40 /* SetLineDash */);
        const count = Math.min(state.lineDash.length, 255);
        buf.u8(count);
        for (let i = 0; i < count; i++) buf.f32(state.lineDash[i]);
        sent2.lineDash = [...state.lineDash];
      }
      if (state.lineDashOffset !== sent2.lineDashOffset) {
        this.surface.writer.cmd(41 /* SetLineDashOffset */).f32(state.lineDashOffset);
        sent2.lineDashOffset = state.lineDashOffset;
      }
    }
    syncText() {
      const state = this.state;
      const sent2 = this.sent;
      if (state.fontSource !== sent2.fontSource) {
        const id = this.surface.writer.str(state.font.family);
        const buf = this.surface.writer.cmd(44 /* SetFont */);
        buf.u16(id);
        buf.f32(state.font.size);
        buf.u16(state.font.weight);
        buf.u8(state.font.italic ? 1 : 0);
        sent2.fontSource = state.fontSource;
        sent2.font = state.font;
      }
      if (state.textAlign !== sent2.textAlign) {
        this.surface.writer.cmd(45 /* SetTextAlign */).u8(TEXT_ALIGN[state.textAlign]);
        sent2.textAlign = state.textAlign;
      }
      if (state.textBaseline !== sent2.textBaseline) {
        this.surface.writer.cmd(46 /* SetTextBaseline */).u8(TEXT_BASELINE[state.textBaseline]);
        sent2.textBaseline = state.textBaseline;
      }
    }
    writeStyle(style, colorCmd, handleCmd) {
      if (typeof style === "string") {
        const id = this.surface.writer.str(style);
        this.surface.writer.cmd(colorCmd).u16(id);
        return;
      }
      style.define(this.surface.writer);
      this.surface.writer.cmd(handleCmd).u32(style.handle);
    }
  };
  function sameDash(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // packages/fjs-runtime/src/canvas/context-registry.ts
  var factories = /* @__PURE__ */ new Map();
  function registerContextType(type, factory) {
    factories.set(type, factory);
  }
  var claimed = /* @__PURE__ */ new WeakMap();
  function resolveContext(cache2, type, target, attributes) {
    const cached = cache2.get(type);
    if (cached !== void 0) return cached;
    const owner = claimed.get(cache2);
    if (owner !== void 0 && owner !== type) {
      warnCanvasOnce(
        `context:${type}`,
        `canvas.getContext("${type}") returns null: this canvas already created a "${owner}" context. A DOM canvas hands out one kind of context per element, and so do we (on both platforms).`
      );
      cache2.set(type, null);
      return null;
    }
    const factory = factories.get(type);
    if (!factory) {
      warnCanvasOnce(
        `context:${type}`,
        `canvas.getContext("${type}") is not supported by fjs; see docs/canvas-compat.md. Returning null on both Flutter and web so a page behaves the same on either.`
      );
      cache2.set(type, null);
      return null;
    }
    const context = factory(target, attributes);
    cache2.set(type, context);
    if (context !== null) claimed.set(cache2, type);
    return context;
  }
  registerContextType("2d", (target) => {
    if (target.domCanvas) return target.domCanvas.getContext("2d");
    if (!target.surface) return null;
    return new FjsCanvasRenderingContext2D(target.surface, target.canvas);
  });

  // packages/fjs-runtime/src/canvas/surface.ts
  var CANVAS_RESIZE_EVENT = 30;
  var dirty = /* @__PURE__ */ new Set();
  var drainInstalled = false;
  var FjsCanvasSurface = class {
    constructor(nodeId, element) {
      this.nodeId = nodeId;
      this.element = element;
      /** Contexts by type, so getContext returns the same object every time. */
      this.contexts = /* @__PURE__ */ new Map();
      this.w = 0;
      this.h = 0;
      /** Device ratio the host renders this canvas's bitmap at. 1 until the
       * host's size event says otherwise; context modules that own a real
       * backing store multiply their bitmap size by it (the 2d context ignores
       * it — logical pixels there). */
      this.dpr = 1;
      /** Attached context-module writers. Empty for a page that never leaves
       * the 2d context — the common case pays nothing. */
      this.opWriters = [];
      this.writer = new CanvasWriter(() => {
        dirty.add(this);
        scheduleFlush();
      });
      listenCanvasSize(nodeId, (width, height, devicePixelRatio) => {
        var _a4;
        this.w = width;
        this.h = height;
        if (typeof devicePixelRatio === "number" && devicePixelRatio > 0) {
          this.dpr = devicePixelRatio;
        }
        (_a4 = nodeHandler(nodeId, CANVAS_RESIZE_EVENT)) == null ? void 0 : _a4(
          `{"width":${width},"height":${height}}`
        );
      });
    }
    width() {
      return this.w;
    }
    height() {
      return this.h;
    }
    devicePixelRatio() {
      return this.dpr;
    }
    /** Context-module extension point (see FjsCanvasOpWriter). */
    attachOpWriter(w) {
      this.opWriters.push(w);
    }
    /** What a module's writer calls when it has new bytes: same dirty set the
     * 2d writer feeds, one flush per tick. */
    markDirty() {
      dirty.add(this);
      scheduleFlush();
    }
    getContext(type, attributes) {
      return resolveContext(this.contexts, type, {
        canvas: this.element,
        surface: this
      }, attributes);
    }
    flush() {
      for (const chunk of this.writer.takeChunks()) {
        getWriter().canvas(this.nodeId, chunk);
      }
      for (const w of this.opWriters) {
        for (const chunk of w.takeChunks()) {
          w.write(this.nodeId, chunk);
        }
      }
    }
    dispose() {
      dirty.delete(this);
      forgetCanvasSize(this.nodeId);
    }
  };
  function attachCanvas(el, registerSystemHandler2) {
    setCanvasEventRegistrar(registerSystemHandler2);
    installDrain();
    const surface = new FjsCanvasSurface(el.id, el);
    el.__canvas = surface;
    el.getContext = (type, attributes) => surface.getContext(type, attributes);
    el.toDataURL = (type, quality) => canvasToDataURL(el.id, type, quality);
    Object.defineProperty(el, "width", {
      get: () => surface.width(),
      configurable: true
    });
    Object.defineProperty(el, "height", {
      get: () => surface.height(),
      configurable: true
    });
    Object.defineProperty(el, "devicePixelRatio", {
      get: () => 1,
      configurable: true
    });
  }
  function detachCanvas(el) {
    const surface = el.__canvas;
    if (surface instanceof FjsCanvasSurface) surface.dispose();
  }
  function installDrain() {
    if (drainInstalled) return;
    drainInstalled = true;
    registerPreFlush(() => {
      if (dirty.size === 0) return;
      const pending = [...dirty];
      dirty.clear();
      for (const surface of pending) surface.flush();
    });
  }

  // packages/fjs-runtime/src/ui/touch.ts
  var TOUCH_TYPES = {
    15: "touchstart",
    16: "touchmove",
    17: "touchend",
    18: "touchcancel"
  };
  function isTouchEvent(eventType) {
    return eventType >= 15 && eventType <= 18;
  }
  function noop() {
  }
  function makeTouch(t, origin) {
    const [identifier, x, y] = t;
    return {
      identifier,
      x,
      y,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
      screenX: x,
      screenY: y,
      offsetX: x - origin[0],
      offsetY: y - origin[1]
    };
  }
  function makeList(raw, fallback, origin) {
    return raw === void 0 ? fallback : raw.map((t) => makeTouch(t, origin));
  }
  function decodeTouchEvent(eventType, payload) {
    var _a4, _b3, _c, _d;
    const type = TOUCH_TYPES[eventType];
    if (!type || !payload) return null;
    let wire;
    try {
      wire = JSON.parse(payload);
    } catch {
      console.warn("[fjs] bad touch payload", payload);
      return null;
    }
    const origin = (_a4 = wire.o) != null ? _a4 : [0, 0];
    const touches = ((_b3 = wire.touches) != null ? _b3 : []).map((t) => makeTouch(t, origin));
    const target = { id: (_c = wire.id) != null ? _c : "" };
    return {
      type,
      timeStamp: (_d = wire.ts) != null ? _d : 0,
      target,
      currentTarget: target,
      touches,
      targetTouches: makeList(wire.tt, touches, origin),
      changedTouches: makeList(wire.changed, touches, origin),
      preventDefault: noop,
      stopPropagation: noop
    };
  }

  // packages/fjs-runtime/src/ui/geometry.ts
  function makeRect(left, top, width, height) {
    return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height };
  }
  function hostNumbers(name, ...args) {
    if (!hasNativeHost) return null;
    try {
      const raw = invokeHost(name, ...args);
      if (typeof raw !== "string") return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.every((n) => typeof n === "number") ? parsed : null;
    } catch {
      return null;
    }
  }
  function boundingRectOf(id) {
    if (hasNativeHost) flushNow();
    const r = hostNumbers("fjs.ui.rect", id);
    return r && r.length === 4 ? makeRect(r[0], r[1], r[2], r[3]) : makeRect(0, 0, 0, 0);
  }
  function lastPointer() {
    const p = hostNumbers("fjs.ui.pointer");
    return p && p.length === 2 ? { x: p[0], y: p[1] } : null;
  }

  // packages/fjs-runtime/src/ui/element.ts
  var INNER_CANVAS_TAG = "inner-canvas";
  var EVENT_PREFIX = "on";
  var EventType = {
    onTap: 1,
    onClick: 1,
    onLongPress: 2,
    onTextChanged: 3,
    onSubmit: 4,
    onValueChanged: 5,
    onPageChanged: 6,
    onModalClosed: 7,
    onRefresh: 8,
    onScroll: 12,
    // 20-23: focus/blur carry the field's current text; form submit carries a
    // {name: value} JSON string (see widgets/form.dart for the shape).
    onFocus: 20,
    onBlur: 21,
    onFormSubmit: 22,
    onFormReset: 23,
    // scroll-view's edge events. The scroll event itself is 12; its payload is
    // the JSON scroll/metrics.ts writes, not a bare offset.
    // `@scrolltolower` in a template becomes `onScrolltolower` — the all-lower
    // spelling is the one that actually shows up, so it is canonical here and
    // on the Dart side; the camelCase alias is for hand-written h() calls.
    onScrolltoupper: 24,
    onScrollToUpper: 24,
    onScrolltolower: 25,
    onScrollToLower: 25,
    // 26/27 are not image-only: they are "this node's resource loaded /
    // failed", and the payload's shape is the tag's (image sends
    // {width,height}, web-view sends {src}). A module tag uses these numbers
    // rather than inventing its own — the three tables are the one authority
    // on the numbering (constitution II).
    onLoad: 26,
    onError: 27,
    // textarea's line count. Same all-lower-first rule as the edge events:
    // `@linechange` in a template becomes `onLinechange`.
    onLinechange: 28,
    onLineChange: 28,
    // a webview's page called fjs.postMessage; payload is {"data":"…"}
    onMessage: 29,
    // a canvas node was laid out or resized; payload is
    // {"width":n,"height":n} in LOGICAL pixels. Number 30 is the canvas
    // subsystem's (fjs.h FJS_EVENT_CANVAS) — the same number also carries
    // image/dataURL results, which is why the payload is discriminated and
    // why canvas/surface.ts, not this dispatcher, decides which of the two
    // a given event is.
    onResize: 30,
    // touch: the DOM names, so `@touchstart` in a template lands here. The
    // camelCase spellings are aliases for hand-written h() calls.
    onTouchstart: 15,
    onTouchStart: 15,
    onTouchmove: 16,
    onTouchMove: 16,
    onTouchend: 17,
    onTouchEnd: 17,
    onTouchcancel: 18,
    onTouchCancel: 18,
    // sticky-header's pin-state flip (specs/052). Same all-lower-first rule
    // as the edge events: `@stickontopchange` becomes `onStickontopchange`.
    // Payload is the JSON string {"isStickOnTop":boolean}.
    onStickontopchange: 34,
    onStickOnTopChange: 34,
    // page-container's transition lifecycle (specs/065), no payloads. The
    // camelCase spellings are canonical — `@before-enter` in a template
    // becomes the prop `onBeforeEnter` — with the all-lower aliases for
    // hand-written h() calls, mirroring the wx event names.
    onBeforeEnter: 35,
    onBeforeenter: 35,
    onEnter: 36,
    onAfterEnter: 37,
    onAfterenter: 37,
    onBeforeLeave: 38,
    onBeforeleave: 38,
    onLeave: 39,
    onAfterLeave: 40,
    onAfterleave: 40,
    onClickoverlay: 41,
    onClickOverlay: 41,
    // a CSS transform/opacity transition ran to its end (specs/073), no
    // payload. `@transitionend` in a template becomes `onTransitionend` (the
    // canonical spelling); vant's NoticeBar restarts its marquee on it.
    onTransitionend: 42,
    onTransitionEnd: 42
  };
  var CANONICAL_EVENT_PROP = {
    onScrollToUpper: "onScrolltoupper",
    onScrollToLower: "onScrolltolower",
    onLineChange: "onLinechange",
    onTouchStart: "onTouchstart",
    onTouchMove: "onTouchmove",
    onTouchEnd: "onTouchend",
    onTouchCancel: "onTouchcancel",
    onTransitionEnd: "onTransitionend",
    onBeforeenter: "onBeforeEnter",
    onAfterenter: "onAfterEnter",
    onBeforeleave: "onBeforeLeave",
    onAfterleave: "onAfterLeave",
    onClickOverlay: "onClickoverlay"
  };
  var nextId = 1;
  var eventHandlers = /* @__PURE__ */ new Map();
  var domListeners = /* @__PURE__ */ new Map();
  var workerHandlers = /* @__PURE__ */ new Map();
  var systemHandlers = /* @__PURE__ */ new Map();
  var warned2 = /* @__PURE__ */ new Set();
  function warnOnce(key, message) {
    if (warned2.has(key)) return;
    warned2.add(key);
    console.warn(`[fjs] ${message}`);
  }
  function nodeHandler(nodeId, type) {
    return eventHandlers.get(handlerKey(nodeId, type));
  }
  function handlerKey(nodeId, type) {
    return `${nodeId}:${type}`;
  }
  var fieldNames = /* @__PURE__ */ new Map();
  var fieldFormTypes = /* @__PURE__ */ new Map();
  var fieldValues = /* @__PURE__ */ new Map();
  function recordField(nodeId, key, value) {
    if (key === "name") {
      if (value == null || value === "") fieldNames.delete(nodeId);
      else fieldNames.set(nodeId, String(value));
      return;
    }
    if (key === "formType") {
      if (value == null || value === "") fieldFormTypes.delete(nodeId);
      else fieldFormTypes.set(nodeId, String(value));
      return;
    }
    if (key !== "value") return;
    if (value == null) fieldValues.delete(nodeId);
    else fieldValues.set(nodeId, typeof value === "boolean" ? value ? "1" : "0" : String(value));
  }
  var EVENT_TYPES = [...new Set(Object.values(EventType))];
  function forgetHandlers(nodeId) {
    for (let i = 0; i < EVENT_TYPES.length; i++) {
      eventHandlers.delete(handlerKey(nodeId, EVENT_TYPES[i]));
      domListeners.delete(handlerKey(nodeId, EVENT_TYPES[i]));
    }
    fieldNames.delete(nodeId);
    fieldFormTypes.delete(nodeId);
    fieldValues.delete(nodeId);
  }
  function registerSystemHandler(type, handler) {
    systemHandlers.set(type, handler);
  }
  function installEventDispatcher() {
    globalThis.__fjsDispatchEvent = (nodeId, eventType, payload) => {
      var _a4;
      if (eventType === 9) {
        (_a4 = workerHandlers.get(nodeId)) == null ? void 0 : _a4(payload != null ? payload : "");
        return;
      }
      const system = systemHandlers.get(eventType);
      if (system) {
        system(nodeId, payload != null ? payload : void 0);
        return;
      }
      if (eventType === 3 || eventType === 5) {
        fieldValues.set(nodeId, payload != null ? payload : "");
      }
      const key = handlerKey(nodeId, eventType);
      const handler = eventHandlers.get(key);
      const listeners = domListeners.get(key);
      if (!handler && !listeners) return;
      if (isTouchEvent(eventType)) {
        const event = decodeTouchEvent(eventType, payload);
        if (!event) return;
        handler == null ? void 0 : handler(event);
        if (listeners) for (const fn of [...listeners]) fn(event);
        return;
      }
      handler == null ? void 0 : handler(payload != null ? payload : void 0);
      if (listeners) {
        const event = { detail: payload != null ? payload : void 0, preventDefault() {
        }, stopPropagation() {
        } };
        for (const fn of [...listeners]) fn(event);
      }
    };
  }
  var offsetParentResolver = null;
  function setOffsetParentResolver(resolver) {
    offsetParentResolver = resolver;
  }
  function offsetOf(el, axis) {
    const own = boundingRectOf(el.id)[axis];
    const parent = offsetParentResolver == null ? void 0 : offsetParentResolver(el.id);
    return parent ? own - boundingRectOf(parent.id)[axis] : own;
  }
  var OFFSET_DESCRIPTORS = {
    offsetWidth: {
      get() {
        return boundingRectOf(this.id).width;
      }
    },
    offsetHeight: {
      get() {
        return boundingRectOf(this.id).height;
      }
    },
    offsetLeft: {
      get() {
        return offsetOf(this, "left");
      }
    },
    offsetTop: {
      get() {
        return offsetOf(this, "top");
      }
    },
    offsetParent: {
      get() {
        var _a4;
        return (_a4 = offsetParentResolver == null ? void 0 : offsetParentResolver(this.id)) != null ? _a4 : null;
      }
    }
  };
  function create(tag) {
    const id = nextId++;
    getWriter().create(id, tag);
    scheduleFlush();
    const el = makeElement(id, tag);
    if (tag === INNER_CANVAS_TAG) {
      attachCanvas(
        el,
        registerSystemHandler
      );
    }
    return el;
  }
  function makeElement(id, tag) {
    const el = {
      id,
      tag,
      // Real value attached by the defineProperty below — lazily, because a
      // page has hundreds of elements and almost none is ever touched by a
      // DOM-style library.
      style: null,
      // replaced by the OFFSET_DESCRIPTORS getters below
      offsetWidth: 0,
      offsetHeight: 0,
      offsetLeft: 0,
      offsetTop: 0,
      offsetParent: null,
      appendChild(child) {
        insert(el, child);
        return child;
      },
      removeChild(child) {
        getWriter().removeChild(id, child.id);
        getWriter().remove(child.id);
        forgetHandlers(child.id);
        forgetElementStyle(child.id);
        if (child.tag === INNER_CANVAS_TAG) detachCanvas(child);
        scheduleFlush();
        return child;
      },
      setText(text) {
        getWriter().setText(id, text);
        scheduleFlush();
        return el;
      },
      setProps(props) {
        setProps(el, props);
        return el;
      },
      getBoundingClientRect() {
        return boundingRectOf(id);
      },
      addEventListener(type, listener) {
        addDomListener(el, type, listener);
      },
      removeEventListener(type, listener) {
        removeDomListener(el, type, listener);
      },
      focus() {
        if (hasNativeHost) invokeHost("fjs.control.focus", id);
      },
      blur() {
        if (hasNativeHost) invokeHost("fjs.control.blur", id);
      }
    };
    Object.defineProperty(el, "style", {
      get() {
        return createElementStyle(id);
      }
    });
    Object.defineProperties(el, OFFSET_DESCRIPTORS);
    return el;
  }
  var styleBridge = null;
  var fallbackStyles = /* @__PURE__ */ new Map();
  function setElementStyleBridge(bridge) {
    styleBridge = bridge;
  }
  function forgetElementStyle(id) {
    fallbackStyles.delete(id);
  }
  function readStyleRecord(id) {
    if (styleBridge) return styleBridge.read(id);
    return fallbackStyles.get(id);
  }
  function writeStyleProp(id, key, value) {
    var _a4;
    if (styleBridge) {
      styleBridge.write(id, key, value);
      return;
    }
    warnOnce(
      "element-style-no-engine",
      "el.style write without a style engine: the value is kept for reads but will not restyle the element"
    );
    const record = (_a4 = fallbackStyles.get(id)) != null ? _a4 : {};
    if (value == null || value === "") delete record[key];
    else record[key] = value;
    fallbackStyles.set(id, record);
  }
  function createElementStyle(id) {
    const methods = {
      setProperty(name, value) {
        writeStyleProp(id, name, value);
      },
      getPropertyValue(name) {
        var _a4;
        const value = (_a4 = readStyleRecord(id)) == null ? void 0 : _a4[name];
        return value == null ? "" : String(value);
      },
      removeProperty(name) {
        var _a4;
        const previous = (_a4 = readStyleRecord(id)) == null ? void 0 : _a4[name];
        writeStyleProp(id, name, null);
        return previous == null ? "" : String(previous);
      }
    };
    return new Proxy(methods, {
      get(target, prop) {
        var _a4;
        if (prop in target) return target[prop];
        const value = (_a4 = readStyleRecord(id)) == null ? void 0 : _a4[prop];
        return value == null ? "" : String(value);
      },
      set(target, prop, value) {
        if (prop in target) {
          target[prop] = value;
          return true;
        }
        writeStyleProp(id, prop, value);
        return true;
      }
    });
  }
  function setProps(el, props) {
    var _a4, _b3;
    const clean = {};
    let changed = false;
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === "function" && key.startsWith(EVENT_PREFIX)) {
        const type = EventType[key];
        if (type !== void 0) {
          const registryKey = handlerKey(el.id, type);
          const had = eventHandlers.has(registryKey) || domListeners.has(registryKey);
          eventHandlers.set(registryKey, value);
          if (!had) {
            clean[(_a4 = CANONICAL_EVENT_PROP[key]) != null ? _a4 : key] = true;
            changed = true;
          }
        } else {
          warnOnce(
            `unknown-handler:${key}`,
            `<${el.tag}> got a handler prop "${key}" that fjs does not know; it will never fire. Check the event name against EventType (packages/fjs-runtime/src/ui/element.ts).`
          );
        }
      } else if (value === null && key.startsWith(EVENT_PREFIX) && EventType[key] !== void 0) {
        const registryKey = handlerKey(el.id, EventType[key]);
        if (eventHandlers.delete(registryKey) && !domListeners.has(registryKey)) {
          clean[(_b3 = CANONICAL_EVENT_PROP[key]) != null ? _b3 : key] = false;
          changed = true;
        }
      } else {
        recordField(el.id, key, value);
        clean[key] = value;
        changed = true;
      }
    }
    if (!changed) return;
    getWriter().setProps(el.id, clean);
    devtoolsSlots.recordProps(el.id, clean);
    scheduleFlush();
  }
  function domEventProp(type) {
    const prop = `on${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    return EventType[prop] !== void 0 ? prop : void 0;
  }
  function addDomListener(el, type, listener) {
    var _a4;
    const prop = domEventProp(type);
    if (!prop) {
      warnOnce(
        `unknown-listener:${type}`,
        `<${el.tag}> addEventListener('${type}'): fjs has no such event; the listener will never fire.`
      );
      return;
    }
    const key = handlerKey(el.id, EventType[prop]);
    const marked = eventHandlers.has(key) || domListeners.has(key);
    let set = domListeners.get(key);
    if (!set) domListeners.set(key, set = /* @__PURE__ */ new Set());
    set.add(listener);
    if (!marked) {
      getWriter().setProps(el.id, { [(_a4 = CANONICAL_EVENT_PROP[prop]) != null ? _a4 : prop]: true });
      scheduleFlush();
    }
  }
  function removeDomListener(el, type, listener) {
    var _a4;
    const prop = domEventProp(type);
    if (!prop) return;
    const key = handlerKey(el.id, EventType[prop]);
    const set = domListeners.get(key);
    if (!(set == null ? void 0 : set.delete(listener)) || set.size) return;
    domListeners.delete(key);
    if (!eventHandlers.has(key)) {
      getWriter().setProps(el.id, { [(_a4 = CANONICAL_EVENT_PROP[prop]) != null ? _a4 : prop]: false });
      scheduleFlush();
    }
  }
  function setStyle(el, style, activeStyle) {
    getWriter().setStyle(el.id, style, activeStyle);
    scheduleFlush();
  }
  function setHoverStyle(el, hoverStyle) {
    getWriter().setHoverStyle(el.id, hoverStyle);
    scheduleFlush();
  }
  function setText(el, text) {
    el.setText(text);
  }
  function insert(parent, child, index) {
    getWriter().insert(parent.id, child.id, index != null ? index : 2147483647);
    devtoolsStructuralVersion.value++;
    scheduleFlush();
  }
  function remove(el) {
    getWriter().remove(el.id);
    forgetHandlers(el.id);
    if (el.tag === INNER_CANVAS_TAG) detachCanvas(el);
    devtoolsStructuralVersion.value++;
    scheduleFlush();
  }
  function createRoot(tag = "view") {
    const root = create(tag);
    getWriter().insert(0, root.id, 0);
    scheduleFlush();
    return root;
  }
  installEventDispatcher();

  // packages/fjs-runtime/src/raf.ts
  var EVENT_RAF = 19;
  var nextId2 = 1;
  var callbacks = /* @__PURE__ */ new Map();
  function requestNativeAnimationFrame(cb) {
    const id = nextId2++;
    callbacks.set(id, cb);
    invokeHost("js.raf.request", id);
    return id;
  }
  function cancelNativeAnimationFrame(id) {
    callbacks.delete(id);
  }
  if (hasNativeHost) {
    registerSystemHandler(EVENT_RAF, (id, payload) => {
      const cb = callbacks.get(id);
      if (!cb) return;
      callbacks.delete(id);
      cb(payload == null ? nowMs() : Number(payload));
    });
    const g2 = globalThis;
    if (typeof g2.requestAnimationFrame !== "function") {
      g2.requestAnimationFrame = requestNativeAnimationFrame;
    }
    if (typeof g2.cancelAnimationFrame !== "function") {
      g2.cancelAnimationFrame = cancelNativeAnimationFrame;
    }
  }

  // packages/fjs-runtime/src/vue/renderer.ts
  var import_runtime_core = __toESM(require_runtime_core(), 1);

  // packages/fjs-runtime/src/vue/transition-classes.ts
  var transitionClasses = /* @__PURE__ */ new WeakMap();
  function transitionClassesOf(el) {
    const set = transitionClasses.get(el);
    return set ? [...set] : [];
  }

  // packages/fjs-runtime/src/css/font-shorthand.ts
  var FONT_LONGHANDS = ["fontStyle", "fontWeight", "fontSize", "lineHeight", "fontFamily"];
  var FONT_PENDING = "\0font\0";
  var STYLE_WORDS = /* @__PURE__ */ new Set(["italic", "oblique"]);
  var WEIGHT_WORDS = /* @__PURE__ */ new Set(["bold", "bolder", "lighter"]);
  var SIZE_WORDS = /* @__PURE__ */ new Set(["xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large", "larger", "smaller"]);
  var IGNORED_WORDS = /* @__PURE__ */ new Set([
    "normal",
    "small-caps",
    "ultra-condensed",
    "extra-condensed",
    "condensed",
    "semi-condensed",
    "semi-expanded",
    "expanded",
    "extra-expanded",
    "ultra-expanded"
  ]);
  var LENGTH_RE = /^(\d*\.?\d+)(px|em|rem|%|pt|vw|vh)?$/;
  function parseFontShorthand(value) {
    const v = value.trim();
    const out = {
      fontStyle: "normal",
      fontWeight: "normal",
      fontSize: "",
      lineHeight: "normal",
      fontFamily: ""
    };
    let i = 0;
    const nextToken = () => {
      while (i < v.length && /\s/.test(v[i])) i++;
      if (i >= v.length) return null;
      const start = i;
      let depth = 0;
      while (i < v.length) {
        const ch = v[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (depth === 0 && (/\s/.test(ch) || ch === "/")) break;
        i++;
      }
      if (i === start && v[i] === "/") {
        i++;
        return "/";
      }
      return v.slice(start, i);
    };
    for (; ; ) {
      const t = nextToken();
      if (t === null) return null;
      const low = t.toLowerCase();
      if (STYLE_WORDS.has(low)) out.fontStyle = low;
      else if (WEIGHT_WORDS.has(low) || /^[1-9]00$/.test(low)) out.fontWeight = low;
      else if (IGNORED_WORDS.has(low)) continue;
      else if (SIZE_WORDS.has(low) || LENGTH_RE.test(low) || /^calc\(/.test(low)) {
        out.fontSize = t;
        break;
      } else return null;
    }
    const save = i;
    const slash = nextToken();
    if (slash === "/") {
      const lh = nextToken();
      if (lh === null) return null;
      out.lineHeight = lh;
    } else {
      i = save;
    }
    out.fontFamily = v.slice(i).trim();
    return out.fontFamily ? out : null;
  }
  function fontFamilyList(value) {
    if (typeof value !== "string") return [];
    const out = [];
    for (const part of value.split(/,(?=(?:[^"']|"[^"]*"|'[^']*')*$)/)) {
      const name = part.trim().replace(/^(['"])(.*)\1$/, "$2").trim();
      if (name) out.push(name);
    }
    return out;
  }

  // packages/fjs-runtime/src/css/animation.ts
  var ANIMATION_LONGHANDS = [
    "animationName",
    "animationDuration",
    "animationTimingFunction",
    "animationDelay",
    "animationIterationCount",
    "animationDirection",
    "animationFillMode",
    "animationPlayState"
  ];
  var ANIMATION_PENDING = " animation ";
  var INITIAL = {
    animationName: "none",
    animationDuration: "0s",
    animationTimingFunction: "ease",
    animationDelay: "0s",
    animationIterationCount: "1",
    animationDirection: "normal",
    animationFillMode: "none",
    animationPlayState: "running"
  };
  var TIMING_WORDS = /* @__PURE__ */ new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"]);
  var DIRECTION_WORDS = /* @__PURE__ */ new Set(["normal", "reverse", "alternate", "alternate-reverse"]);
  var FILL_WORDS = /* @__PURE__ */ new Set(["none", "forwards", "backwards", "both"]);
  var PLAY_WORDS = /* @__PURE__ */ new Set(["running", "paused"]);
  var TIME = /^-?(\d+\.?\d*|\.\d+)m?s$/i;
  var NUMBER = /^(\d+\.?\d*|\.\d+)$/;
  function split(text, sep) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (const ch of text) {
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      if (depth === 0 && sep.test(ch)) {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function parseAnimationShorthand(value) {
    var _a4, _b3;
    const lists = {
      animationName: [],
      animationDuration: [],
      animationTimingFunction: [],
      animationDelay: [],
      animationIterationCount: [],
      animationDirection: [],
      animationFillMode: [],
      animationPlayState: []
    };
    for (const layer of split(value, /,/)) {
      const one = {};
      for (const token of split(layer, /\s/)) {
        const t = token.toLowerCase();
        if (TIME.test(t)) {
          if (one.animationDuration === void 0) one.animationDuration = token;
          else (_a4 = one.animationDelay) != null ? _a4 : one.animationDelay = token;
        } else if (one.animationTimingFunction === void 0 && (TIMING_WORDS.has(t) || /^(cubic-bezier|steps)\(/.test(t))) {
          one.animationTimingFunction = token;
        } else if (one.animationIterationCount === void 0 && (t === "infinite" || NUMBER.test(t))) {
          one.animationIterationCount = token;
        } else if (one.animationDirection === void 0 && DIRECTION_WORDS.has(t)) {
          one.animationDirection = token;
        } else if (one.animationFillMode === void 0 && FILL_WORDS.has(t) && t !== "none") {
          one.animationFillMode = token;
        } else if (one.animationPlayState === void 0 && PLAY_WORDS.has(t)) {
          one.animationPlayState = token;
        } else if (one.animationName === void 0) {
          one.animationName = token;
        }
      }
      for (const k of ANIMATION_LONGHANDS) lists[k].push((_b3 = one[k]) != null ? _b3 : INITIAL[k]);
    }
    const out = {};
    for (const k of ANIMATION_LONGHANDS) out[k] = lists[k].length ? lists[k].join(", ") : INITIAL[k];
    return out;
  }
  function parseKeyframes(name, block, parseDecls) {
    var _a4;
    const byOffset = /* @__PURE__ */ new Map();
    let i = 0;
    while (i < block.length) {
      const open = block.indexOf("{", i);
      if (open < 0) break;
      const close = block.indexOf("}", open);
      const selector = block.slice(i, open).trim();
      const decls = parseDecls(block.slice(open + 1, close < 0 ? block.length : close));
      i = close < 0 ? block.length : close + 1;
      for (const part of selector.split(",")) {
        const p = part.trim().toLowerCase();
        const offset = p === "from" ? 0 : p === "to" ? 1 : p.endsWith("%") ? parseFloat(p) / 100 : NaN;
        if (!Number.isFinite(offset) || offset < 0 || offset > 1) continue;
        byOffset.set(offset, { ...(_a4 = byOffset.get(offset)) != null ? _a4 : {}, ...decls });
      }
    }
    const frames = [...byOffset.entries()].sort((a, b) => a[0] - b[0]).map(([offset, decls]) => ({ offset, decls }));
    return { name: name.trim().replace(/^["']|["']$/g, ""), frames };
  }

  // packages/fjs-runtime/src/css/parser.ts
  var DISABLED_CLASS = ":disabled";
  var CLASS_ATTR_RE = /\[\s*class\s*([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))\s*\]/g;
  function mediaMatches(condition, width, height) {
    return condition.some((branch) => {
      for (const f of branch.features) {
        if (f.prop === "orientation") {
          const portrait = height >= width;
          if (f.keyword === "portrait" !== portrait) return false;
        } else if (f.op === "min") {
          if ((f.prop === "width" ? width : height) < f.value) return false;
        } else if (f.op === "max") {
          if ((f.prop === "width" ? width : height) > f.value) return false;
        } else if ((f.prop === "width" ? width : height) !== f.value) {
          return false;
        }
      }
      return true;
    });
  }
  function parseMediaCondition(text) {
    let out = null;
    for (const raw of splitTopLevel(text, ",")) {
      const branch = parseMediaBranch(raw.trim());
      if (branch === null) return null;
      (out != null ? out : out = []).push(branch);
    }
    if (out === null || out.length === 0) {
      warnOnce2(`@media "${text.trim()}" has no condition, skipped`);
      return null;
    }
    return out;
  }
  function parseMediaBranch(text) {
    var _a4;
    if (/^only\s+/i.test(text)) text = text.replace(/^only\s+/i, "");
    const tokens = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i <= text.length; i++) {
      const ch = i === text.length ? " " : text[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      else if (depth === 0 && /\s/.test(ch)) {
        if (i > start) tokens.push(text.slice(start, i));
        start = i + 1;
      }
    }
    const branch = { type: null, features: [] };
    let expectTerm = true;
    for (const token of tokens) {
      if (/^and$/i.test(token)) {
        if (expectTerm) {
          warnOnce2(`@media "${text.trim()}" uses unsupported syntax, skipped`);
          return null;
        }
        expectTerm = true;
        continue;
      }
      if (!expectTerm) {
        warnOnce2(`@media "${text.trim()}" uses unsupported syntax, skipped`);
        return null;
      }
      expectTerm = false;
      if (token.startsWith("(")) {
        if (!token.endsWith(")")) {
          warnOnce2(`@media "${text.trim()}" uses unsupported syntax, skipped`);
          return null;
        }
        const body = token.slice(1, -1).trim();
        const idx = body.indexOf(":");
        if (idx <= 0) {
          warnOnce2(`@media "${text.trim()}" feature "(${body})" is not supported, skipped`);
          return null;
        }
        const name = body.slice(0, idx).trim().toLowerCase();
        const value = body.slice(idx + 1).trim();
        if (name === "orientation") {
          if (value !== "portrait" && value !== "landscape") {
            warnOnce2(`@media "${text.trim()}" orientation "${value}" is not supported, skipped`);
            return null;
          }
          branch.features.push({ prop: "orientation", keyword: value });
          continue;
        }
        const m = /^(min|max)?-?(width|height)$/.exec(name);
        if (!m) {
          warnOnce2(`@media "${text.trim()}" feature "${name}" is not supported, skipped`);
          return null;
        }
        const num = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(value);
        if (!num) {
          warnOnce2(`@media "${text.trim()}" value "${value}" for "${name}" is not a px length, skipped`);
          return null;
        }
        branch.features.push({
          prop: m[2],
          op: (_a4 = m[1]) != null ? _a4 : null,
          value: parseFloat(num[1])
        });
        continue;
      }
      if (branch.type === null && /^(screen|all)$/i.test(token)) {
        branch.type = token.toLowerCase();
        continue;
      }
      warnOnce2(`@media "${text.trim()}" uses unsupported syntax "${token}", skipped`);
      return null;
    }
    if (expectTerm) {
      warnOnce2(`@media "${text.trim()}" has no condition, skipped`);
      return null;
    }
    return branch;
  }
  var warned3 = /* @__PURE__ */ new Set();
  function warnOnce2(msg) {
    if (warned3.has(msg)) return;
    warned3.add(msg);
    console.warn(`[fjs css] ${msg}`);
  }
  var ROOT_SELECTOR = /^:(?:root|host)$/;
  function parseStylesheet(css, scope, startOrder, fontFaces, keyframes) {
    var _a4, _b3;
    const text = stripComments(css);
    const rules = [];
    let order = startOrder;
    let i = 0;
    while (i < text.length) {
      const brace = text.indexOf("{", i);
      if (brace < 0) break;
      const selectorText = text.slice(i, brace).trim();
      const close = matchBrace(text, brace);
      const block = text.slice(brace + 1, close < 0 ? text.length : close);
      i = close < 0 ? text.length : close + 1;
      if (selectorText.startsWith("@")) {
        if (/^@media\b/.test(selectorText)) {
          const condition = parseMediaCondition(selectorText.slice("@media".length).trim());
          if (condition !== null) {
            parseMediaBlock(block, scope, condition, rules, () => order++);
          }
        } else if (fontFaces && /^@font-face$/i.test(selectorText)) {
          const d = parseDeclarations(block);
          fontFaces.push({
            family: String((_a4 = d.fontFamily) != null ? _a4 : ""),
            src: String((_b3 = d.src) != null ? _b3 : ""),
            ...d.unicodeRange !== void 0 ? { unicodeRange: String(d.unicodeRange) } : {}
          });
        } else if (keyframes && /^@(?:-webkit-)?keyframes\s/i.test(selectorText)) {
          const name = selectorText.replace(/^@(?:-webkit-)?keyframes\s+/i, "");
          keyframes.push(parseKeyframes(name, block, parseDeclarations));
        } else {
          warnOnce2(`at-rule "${selectorText.split(/[\s{]/)[0]}" is not supported, skipped`);
        }
        continue;
      }
      const decls = parseDeclarations(block);
      if (Object.keys(decls).length === 0) continue;
      const selectors = [];
      const pseudoSelectors = [];
      let root = false;
      for (const part of selectorText.split(",")) {
        const trimmed = part.trim();
        if (ROOT_SELECTOR.test(trimmed)) {
          root = true;
          continue;
        }
        const sel = parseSelector(trimmed);
        if (!sel) continue;
        sel.text = trimmed;
        if (sel.pseudo) pseudoSelectors.push(sel);
        else selectors.push(sel);
      }
      if (root) rules.push({ selectors: [], decls, order: order++, scope, root: true });
      if (selectors.length !== 0) rules.push({ selectors, decls, order: order++, scope });
      for (const kind of ["before", "after"]) {
        const group = pseudoSelectors.filter((s) => s.pseudo === kind);
        if (group.length !== 0) {
          rules.push({ selectors: group, decls, order: order++, scope, pseudo: kind });
        }
      }
    }
    return rules;
  }
  function parseMediaBlock(block, scope, media, rules, nextOrder) {
    let i = 0;
    while (i < block.length) {
      const brace = block.indexOf("{", i);
      if (brace < 0) break;
      const selectorText = block.slice(i, brace).trim();
      const close = matchBrace(block, brace);
      const declsText = block.slice(brace + 1, close < 0 ? block.length : close);
      i = close < 0 ? block.length : close + 1;
      if (selectorText.startsWith("@")) {
        warnOnce2(`at-rule "${selectorText.split(/[\s{]/)[0]}" nested inside @media is not supported, skipped`);
        continue;
      }
      const decls = parseDeclarations(declsText);
      if (Object.keys(decls).length === 0) continue;
      const selectors = [];
      for (const part of selectorText.split(",")) {
        const trimmed = part.trim();
        const sel = parseSelector(trimmed);
        if (!sel) continue;
        sel.text = trimmed;
        selectors.push(sel);
      }
      if (selectors.length === 0) continue;
      rules.push({ selectors, decls, order: nextOrder(), scope, media });
    }
  }
  function parseInlineCss(css) {
    return parseDeclarations(stripComments(css));
  }
  function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, "");
  }
  function matchBrace(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }
  function parseDeclarations(block) {
    const out = {};
    for (const decl of splitTopLevel(block, ";")) {
      const idx = decl.indexOf(":");
      if (idx <= 0) continue;
      const rawKey = decl.slice(0, idx).trim();
      let value = decl.slice(idx + 1).trim();
      if (!rawKey || !value) continue;
      if (value.endsWith("!important")) {
        value = value.slice(0, -"!important".length).trim();
      }
      if (!value) continue;
      if (rawKey.startsWith("--")) {
        out[rawKey] = value;
        continue;
      }
      const key = camelize(rawKey);
      if (key === "font") {
        expandFont(value, out);
        continue;
      }
      if (key === "animation") {
        if (value.includes("var(")) {
          for (const k of ANIMATION_LONGHANDS) out[k] = ANIMATION_PENDING + value;
        } else {
          Object.assign(out, parseAnimationShorthand(value));
        }
        continue;
      }
      out[key] = normalizeValue(key, value);
    }
    return out;
  }
  function expandFont(value, out) {
    const keyword = value.trim().toLowerCase();
    if (keyword === "inherit" || keyword === "unset") {
      for (const k of FONT_LONGHANDS) out[k] = "inherit";
      return;
    }
    if (keyword === "initial") {
      for (const k of ["fontStyle", "fontWeight", "lineHeight"]) out[k] = "normal";
      return;
    }
    if (value.includes("var(")) {
      for (const k of FONT_LONGHANDS) out[k] = FONT_PENDING + value;
      return;
    }
    const parts = parseFontShorthand(value);
    if (!parts) {
      warnOnce2(`font shorthand "${value}" is not supported (system fonts / missing size or family), skipped`);
      return;
    }
    for (const k of FONT_LONGHANDS) out[k] = normalizeValue(k, parts[k]);
  }
  function splitTopLevel(text, sep) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      else if (ch === sep && depth === 0) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(text.slice(start));
    return parts;
  }
  function camelize(key) {
    return key.replace(/^-(?:webkit|moz|ms|o)-/, "").replace(/-+([a-z])/g, (_, c) => c.toUpperCase());
  }
  function normalizeValue(key, raw) {
    if (raw.startsWith(FONT_PENDING)) {
      const shorthand = raw.slice(FONT_PENDING.length);
      const parts = parseFontShorthand(shorthand);
      if (!parts) {
        warnOnce2(`font shorthand "${shorthand}" is not supported (system fonts / missing size or family), skipped`);
        return void 0;
      }
      return normalizeValue(key, parts[key]);
    }
    if (raw.startsWith(ANIMATION_PENDING)) {
      return parseAnimationShorthand(raw.slice(ANIMATION_PENDING.length))[key];
    }
    const v = raw.trim();
    if (key === "lineHeight") return v;
    if (/^-?\d+(\.\d+)?px$/.test(v)) return parseFloat(v);
    if (/^-?\d+(\.\d+)?rem$/.test(v)) return parseFloat(v) * 16;
    if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
    return v;
  }
  function parseSelector(raw) {
    var _a4, _b3;
    const { text: unwrapped, deep, global: global2 } = unwrapWrappers(raw);
    let active = false;
    let hover = false;
    let text = unwrapped.trim();
    for (; ; ) {
      if (/:active$/.test(text)) {
        active = true;
        text = text.slice(0, -":active".length).trim();
      } else if (/:hover$/.test(text)) {
        hover = true;
        text = text.slice(0, -":hover".length).trim();
      } else {
        break;
      }
    }
    if (/:active/.test(text)) {
      warnOnce2(`selector "${raw.trim()}" puts :active on something other than its last compound, skipped`);
      return null;
    }
    if (/:hover/.test(text)) {
      warnOnce2(`selector "${raw.trim()}" puts :hover on something other than its last compound, skipped`);
      return null;
    }
    let pseudo;
    const pm = /::?(before|after)$/.exec(text);
    if (pm) {
      pseudo = pm[1];
      text = text.slice(0, -pm[0].length).trim();
    }
    if (/[([:]/.test(text.replace(/:not\(:?(?:first|last)-child\)|:(?:first|last)-child|:disabled(?![\w-])/g, "").replace(CLASS_ATTR_RE, ""))) {
      warnOnce2(`selector "${raw.trim()}" uses unsupported syntax (attr/pseudo/id), skipped`);
      return null;
    }
    const compounds = [];
    const combinators = [];
    let buf = "";
    let pending = null;
    const flush = () => {
      if (!buf) return;
      const compound = parseCompound(buf);
      buf = "";
      if (!compound) return;
      if (pending && compounds.length > 0) combinators.push(pending);
      pending = null;
      compounds.push(compound);
    };
    let bracket = 0;
    for (const ch of text) {
      if (ch === "[") bracket++;
      else if (ch === "]") bracket--;
      if (bracket > 0 || ch === "]") {
        buf += ch;
      } else if (ch === ">") {
        flush();
        pending = "child";
      } else if (ch === "+") {
        flush();
        pending = "nextSibling";
      } else if (/\s/.test(ch)) {
        flush();
        if (pending == null) pending = "descendant";
      } else {
        buf += ch;
      }
    }
    flush();
    if (compounds.length === 0) return null;
    let specificity = 0;
    let pseudos = (active ? 1 : 0) + (hover ? 1 : 0);
    for (const c of compounds) {
      specificity += (c.classes.length + ((_b3 = (_a4 = c.classAttr) == null ? void 0 : _a4.length) != null ? _b3 : 0)) * 10 + (c.tag ? 1 : 0);
      if (c.first) pseudos++;
      if (c.last) pseudos++;
      if (c.notFirst) pseudos++;
      if (c.notLast) pseudos++;
    }
    specificity += pseudos * 10;
    if (pseudo) specificity += 1;
    return pseudo ? { compounds, combinators, deep, active, hover, pseudo, specificity } : { compounds, combinators, deep, active, hover, specificity };
  }
  function unwrapWrappers(sel) {
    let text = sel.replace(/>>>/g, " ");
    let deep = false;
    let global2 = false;
    let out = "";
    let i = 0;
    while (i < text.length) {
      const rest = text.slice(i);
      const paren = /^(:{1,2})(?:v-deep|deep|global)\s*\(/.exec(rest);
      if (paren) {
        if (paren[0].includes("global")) global2 = true;
        else deep = true;
        i += paren[0].length;
        let depth = 1;
        while (i < text.length && depth > 0) {
          const ch = text[i];
          if (ch === "(") depth++;
          else if (ch === ")") {
            depth--;
            if (depth === 0) break;
          }
          out += ch;
          i++;
        }
        i++;
        continue;
      }
      const bare = /^::v-deep(?![\w-])\s*/.exec(rest);
      if (bare) {
        deep = true;
        i += bare[0].length;
        continue;
      }
      out += text[i];
      i++;
    }
    text = out;
    return { text, deep, global: global2 };
  }
  function parseCompound(text) {
    var _a4, _b3;
    const classes = [];
    let tag = null;
    let first = false;
    let last = false;
    let notFirst = false;
    let notLast = false;
    const classAttr = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "[") {
        CLASS_ATTR_RE.lastIndex = i;
        const m = CLASS_ATTR_RE.exec(text);
        if (!m || m.index !== i) return null;
        classAttr.push({ op: m[1], value: (_b3 = (_a4 = m[2]) != null ? _a4 : m[3]) != null ? _b3 : m[4] });
        i += m[0].length;
      } else if (ch === ".") {
        let j = i + 1;
        while (j < text.length && /[\w-]/.test(text[j])) j++;
        if (j === i + 1) return null;
        classes.push(text.slice(i + 1, j));
        i = j;
      } else if (ch === ":") {
        let j = i + 1;
        while (j < text.length && /[\w-]/.test(text[j])) j++;
        const name = text.slice(i + 1, j);
        if (name === "not") {
          if (text[j] !== "(") return null;
          const close = text.indexOf(")", j);
          if (close < 0) return null;
          const arg = text.slice(j + 2, close).trim();
          if (arg === "first-child") notFirst = true;
          else if (arg === "last-child") notLast = true;
          else return null;
          i = close + 1;
        } else {
          if (name === "first-child") first = true;
          else if (name === "last-child") last = true;
          else if (name === "disabled") classes.push(DISABLED_CLASS);
          else return null;
          i = j;
        }
      } else if (ch === "*") {
        tag = null;
        i++;
      } else if (/[A-Za-z]/.test(ch)) {
        let j = i + 1;
        while (j < text.length && /[\w-]/.test(text[j])) j++;
        tag = text.slice(i, j);
        i = j;
      } else {
        return null;
      }
    }
    return {
      tag,
      classes,
      ...first ? { first: true } : {},
      ...last ? { last: true } : {},
      ...notFirst ? { notFirst: true } : {},
      ...notLast ? { notLast: true } : {},
      ...classAttr.length ? { classAttr } : {}
    };
  }

  // packages/fjs-runtime/src/css/font-face.ts
  var declared = /* @__PURE__ */ new Set();
  var sent = /* @__PURE__ */ new Set();
  var loader = hasNativeHost ? (family, dataUrl) => {
    invokeHost("fjs.font.load", family, dataUrl);
  } : null;
  function registerFontFace(face) {
    const family = fontFamilyList(face.family)[0];
    if (!family) {
      warnOnce2("@font-face without a font-family, skipped");
      return;
    }
    if (face.unicodeRange !== void 0) {
      warnOnce2(`@font-face "${family}": unicode-range is not supported, the whole font is used`);
    }
    const dataUrl = pickSource(family, face.src);
    if (dataUrl === null) return;
    declared.add(family.toLowerCase());
    const key = `${family}\0${dataUrl.length}\0${dataUrl.slice(-48)}`;
    if (sent.has(key)) return;
    sent.add(key);
    loader == null ? void 0 : loader(family, dataUrl);
  }
  function usesDeclaredFont(fontFamily) {
    if (declared.size === 0) return false;
    return fontFamilyList(fontFamily).some((f) => declared.has(f.toLowerCase()));
  }
  function pickSource(family, src) {
    var _a4, _b3;
    let sawLocal = false;
    for (const item of splitTopLevel2(src, ",")) {
      const t = item.trim();
      if (/^local\(/i.test(t)) {
        sawLocal = true;
        continue;
      }
      const m = /^url\(\s*(['"]?)(.*?)\1\s*\)/s.exec(t);
      if (!m) continue;
      const url = m[2];
      if (!url.startsWith("data:")) continue;
      const mime = url.slice(5, url.indexOf(",")).split(";")[0].toLowerCase();
      const format = (_b3 = (_a4 = /format\(\s*['"]?([^'")]+)/.exec(t)) == null ? void 0 : _a4[1]) == null ? void 0 : _b3.toLowerCase();
      const sfnt = /(^|\/)(x-font-)?(ttf|otf|sfnt|truetype|opentype)$/.test(mime) || format === "truetype" || format === "opentype";
      if (sfnt) return url;
    }
    warnOnce2(
      `@font-face "${family}": no loadable source \u2014 the App needs a TrueType/OpenType data URL (the fjs build converts woff/woff2 and local files; remote URLs${sawLocal ? " and local()" : ""} are not supported)`
    );
    return null;
  }
  function splitTopLevel2(text, sep) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      else if (ch === sep && depth === 0) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(text.slice(start));
    return parts;
  }

  // packages/fjs-runtime/src/css/style.ts
  var FALLBACK_VIEWPORT = { width: 390, height: 844 };
  var INHERITABLE_KEYS = Object.freeze([
    "color",
    "fontSize",
    "fontFamily",
    "fontStyle",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "textTransform",
    "whiteSpace"
  ]);
  var INHERITABLE = new Set(INHERITABLE_KEYS);
  var FLEX_DISPLAYS = /* @__PURE__ */ new Set(["flex", "inline-flex", "-webkit-flex"]);
  var INITIAL_FONT_PX = 16;
  function pseudoChanged(next, prev) {
    const kind = (a, b) => {
      if (a === void 0 || b === void 0) return a !== b;
      for (const k in a) if (a[k] !== b[k]) return true;
      for (const k in b) if (!(k in a)) return true;
      return false;
    };
    return kind(next.before, prev == null ? void 0 : prev.before) || kind(next.after, prev == null ? void 0 : prev.after);
  }
  var EM_LENGTH = /^(-?\d*\.?\d+)em$/;
  var EM_TOKEN = /(-?\d*\.?\d+)em\b/g;
  var DISABLEABLE_TAGS = /* @__PURE__ */ new Set(["input", "textarea", "button", "select", "option", "fieldset"]);
  function matchClassAttr(t, all) {
    const v = t.value;
    const classes = all.has(DISABLED_CLASS) ? new Set([...all].filter((c) => c !== DISABLED_CLASS)) : all;
    switch (t.op) {
      case "~=":
        return classes.has(v);
      case "|=":
        for (const c of classes) if (c === v || c.startsWith(`${v}-`)) return true;
        return false;
    }
    const attr = [...classes].join(" ");
    switch (t.op) {
      case "=":
        return attr === v;
      case "^=":
        return v !== "" && attr.startsWith(v);
      case "$=":
        return v !== "" && attr.endsWith(v);
      default:
        return v !== "" && attr.includes(v);
    }
  }
  function resolveInheritKeyword(target, parent) {
    for (const k in target) {
      const v = target[k];
      const isInherit = v === "inherit" || k === "color" && typeof v === "string" && v.toLowerCase() === "currentcolor";
      if (!isInherit) continue;
      const p = parent == null ? void 0 : parent[k];
      if (p === void 0) delete target[k];
      else target[k] = p;
    }
  }
  function fontSizePx(value, parentPx) {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const v = value.trim();
      if (/^-?\d*\.?\d+(px)?$/.test(v)) return parseFloat(v);
      if (/^-?\d*\.?\d+rem$/.test(v)) return parseFloat(v) * 16;
      if (/^-?\d*\.?\d+%$/.test(v)) return parentPx * parseFloat(v) / 100;
      if (EM_LENGTH.test(v)) return parentPx * parseFloat(v);
    }
    return parentPx;
  }
  function foldAbsoluteCalc(value) {
    for (let pass = 0; pass < 4; pass++) {
      if (!value.includes("calc(")) return value;
      const next = foldAbsoluteCalcOnce(value);
      if (next === value) break;
      value = next;
    }
    return value;
  }
  function foldAbsoluteCalcOnce(value) {
    return value.replace(/calc\(([^()]*)\)/g, (whole, expr) => {
      const re = /([+-]?)\s*(\d*\.?\d+)\s*(px|%)/g;
      let px = 0;
      let percent = 0;
      let consumed = 0;
      let m;
      while ((m = re.exec(expr)) !== null) {
        const op = (expr.slice(consumed, m.index) + m[1]).replace(/\s+/g, "");
        consumed = m.index + m[0].length;
        const sign = op === "" || op === "+" ? 1 : op === "-" ? -1 : NaN;
        if (Number.isNaN(sign)) return whole;
        const n = parseFloat(m[2]) * sign;
        if (m[3] === "%") percent += n;
        else px += n;
      }
      if (consumed !== expr.trim().length) return whole;
      if (percent !== 0) {
        return `calc(${percent * 100}% ${px < 0 ? "-" : "+"} ${Math.abs(px)}px)`;
      }
      return `${Math.round(px * 100) / 100}px`;
    });
  }
  function resolveEm(style, parentPx) {
    const declared2 = style.fontSize;
    if (typeof declared2 === "string" && /^-?\d*\.?\d+%$/.test(declared2.trim())) {
      style.fontSize = Math.round(fontSizePx(declared2, parentPx) * 100) / 100;
    }
    let own;
    for (const k in style) {
      const v = style[k];
      if (typeof v !== "string") continue;
      let m = EM_LENGTH.exec(v);
      if (m !== null) {
        if (k === "fontSize") {
          own = fontSizePx(v, parentPx);
          style[k] = Math.round(own * 100) / 100;
          continue;
        }
        own != null ? own : own = fontSizePx(style.fontSize, parentPx);
        const px = parseFloat(m[1]) * own;
        style[k] = k === "lineHeight" ? `${Math.round(px * 100) / 100}px` : Math.round(px * 100) / 100;
        continue;
      }
      EM_TOKEN.lastIndex = 0;
      if (v.length < 6 || !EM_TOKEN.test(v)) continue;
      EM_TOKEN.lastIndex = 0;
      own != null ? own : own = fontSizePx(style.fontSize, parentPx);
      style[k] = v.replace(EM_TOKEN, (_, n) => {
        const px = parseFloat(n) * own;
        return `${Math.round(px * 100) / 100}px`;
      });
      if (style[k].includes("calc(")) style[k] = foldAbsoluteCalc(style[k]);
    }
  }
  var RETIRED_CHAIN_LIMIT = 512;
  function newBuckets() {
    return { byClass: /* @__PURE__ */ new Map(), byTag: /* @__PURE__ */ new Map(), catchAll: [] };
  }
  function hasKeys(map) {
    if (map === void 0) return false;
    for (const k in map) {
      return true;
    }
    return false;
  }
  function indexRule(buckets, rule) {
    for (const sel of rule.selectors) {
      const subject = sel.compounds[sel.compounds.length - 1];
      const cls = subject.classes.length > 0 ? subject.classes[0] : null;
      if (cls !== null) {
        const bucket = buckets.byClass.get(cls);
        if (bucket === void 0) buckets.byClass.set(cls, [rule]);
        else bucket.push(rule);
      } else if (subject.tag != null) {
        const bucket = buckets.byTag.get(subject.tag);
        if (bucket === void 0) buckets.byTag.set(subject.tag, [rule]);
        else bucket.push(rule);
      } else {
        buckets.catchAll.push(rule);
      }
    }
  }
  var StyleEngine = class {
    constructor(parentOf2, childrenOf2, applyStyle) {
      this.parentOf = parentOf2;
      this.childrenOf = childrenOf2;
      this.applyStyle = applyStyle;
      this.rules = [];
      this.nextOrder = 0;
      /** Subject-keyed candidates over `rules` / `pseudoRules`, maintained
       * incrementally by [register] (rules are append-only here). Replaces the
       * per-miss full scan; see [indexRule]. */
      this.plainBuckets = newBuckets();
      this.pseudoBuckets = newBuckets();
      /** Dedupe stamp for one candidate walk — plain and pseudo walks share the
       * counter safely because a rule lives in exactly one of the two sets. */
      this.bucketEpoch = 0;
      /** Per-match scratch (the [walkStack] precedent): cascade collections for
       * the current matchRules miss, so a miss allocates only its result. */
      this.matchPlain = [];
      this.matchActive = [];
      this.matchHover = [];
      this.matchAnyActive = false;
      this.matchAnyHover = false;
      /** Dead chains kept for re-use, oldest first — see RETIRED_CHAIN_LIMIT.
       * `retiredHead` indexes into the queue so trimming never shifts the
       * array; the set dedupes re-releases of an already-retired key. */
      this.retiredChains = [];
      this.retiredSet = /* @__PURE__ */ new Set();
      this.retiredHead = 0;
      this.states = /* @__PURE__ */ new Map();
      this.hasPseudo = false;
      /** True once a registered stylesheet contains `@media` rules. Viewport
       * changes then invalidate the whole match cache; with the flag off
       * `setViewport` is an equality check and nothing else. */
      this.hasMedia = false;
      this.viewport = { width: FALLBACK_VIEWPORT.width, height: FALLBACK_VIEWPORT.height };
      /** True once a registered stylesheet contains `:first-child`/`:last-child`.
       * Sibling position is then part of the match key and every tree mutation
       * re-marks siblings; with the flag off both costs stay at zero. */
      this.hasStructural = false;
      /** Some registered selector uses `A + B`: matching then depends on the
       * previous sibling too, which the chain key and the dirty marks must
       * reflect. Off until the first such rule shows up, so pages without one
       * pay nothing. */
      this.hasSiblingRules = false;
      /** `@keyframes` by name; a later block of the same name replaces it. */
      this.keyframes = /* @__PURE__ */ new Map();
      /** Resolved frames per name, for blocks with no var() in them — shared,
       * so every element running the animation compares equal by identity. */
      this.keyframesStatic = /* @__PURE__ */ new Map();
      /** Dirty elements as a plain array, deduplicated by stamping the element
       * rather than hashing it. A Set here grew to the size of the tree on every
       * restyle and was then copied out again to be sorted; on a device the
       * allocation that costs more than the work. */
      this.dirtyList = [];
      this.dirtyEpoch = 1;
      this.flushQueued = false;
      this.matchCache = /* @__PURE__ */ new Map();
      /** chainKey -> small integer, so a child's key embeds its parent's id
       * instead of the parent's whole key (mount builds one key per element and
       * deep trees made those strings grow with depth). */
      this.chainIds = /* @__PURE__ */ new Map();
      this.chainRefs = /* @__PURE__ */ new Map();
      this.nextChainId = 1;
      /** Bumped when the stylesheet changes, which invalidates every element's
       * remembered match without having to walk them. */
      this.matchEpoch = 1;
      /** Identity tokens for the objects the compute cache keys on. Numbers
       * (assigned where each object is created) keep the key a short string and
       * the lookup allocation-free. */
      this.nextObjId = 1;
      this.defaultsIds = /* @__PURE__ */ new WeakMap();
      /** Reused by markDirty so a walk allocates nothing. */
      this.walkStack = [];
      this.counters = { recompute: 0, computeHit: 0, computeMiss: 0, matchHit: 0, matchMiss: 0, applied: 0, flushMs: 0, flushes: 0, markMs: 0, markCalls: 0, markVisited: 0 };
    }
    /** Counters since [resetStats]. Cheap enough to leave on (a few integer
     * increments per element); `examples/hello-fjs`'s theme page reads them. */
    get stats() {
      return {
        ...this.counters,
        elements: this.states.size,
        rules: this.rules.length
      };
    }
    resetStats() {
      this.counters = { recompute: 0, computeHit: 0, computeMiss: 0, matchHit: 0, matchMiss: 0, applied: 0, flushMs: 0, flushes: 0, markMs: 0, markCalls: 0, markVisited: 0 };
    }
    /** Registers a <style> block. scope=null means global (non-scoped). */
    register(scope, cssText2) {
      var _a4, _b3;
      const fontFaces = [];
      const keyframes = [];
      const all = parseStylesheet(cssText2, scope, this.nextOrder, fontFaces, keyframes);
      for (const face of fontFaces) registerFontFace(face);
      for (const k of keyframes) {
        this.keyframes.set(k.name, k);
        this.keyframesStatic.delete(k.name);
      }
      if (all.length === 0) return;
      this.nextOrder = all[all.length - 1].order + 1;
      const parsed = [];
      for (const r of all) {
        if (r.root !== true) {
          if (r.pseudo !== void 0) {
            ((_a4 = this.pseudoRules) != null ? _a4 : this.pseudoRules = []).push(r);
            this.hasPseudo = true;
            indexRule(this.pseudoBuckets, r);
          } else {
            parsed.push(r);
          }
          continue;
        }
        for (const [k, v] of Object.entries(r.decls)) {
          if (k.startsWith("--")) ((_b3 = this.rootCustom) != null ? _b3 : this.rootCustom = {})[normalizeVarKey(k)] = String(v);
          else warnOnce2(`":root" declaration "${k}" is not supported (only custom properties), skipped`);
        }
      }
      this.rules.push(...parsed);
      for (const r of parsed) indexRule(this.plainBuckets, r);
      if (!this.hasMedia) {
        for (const r of parsed) {
          if (r.media !== void 0) {
            this.hasMedia = true;
            break;
          }
        }
      }
      if (!this.hasStructural) {
        for (const r of parsed) {
          if (r.selectors.some((s) => s.compounds.some((c) => c.first || c.last || c.notFirst || c.notLast))) {
            this.hasStructural = true;
            break;
          }
        }
      }
      if (!this.hasSiblingRules) {
        for (const r of parsed) {
          if (r.selectors.some((s) => s.combinators.includes("nextSibling"))) {
            this.hasSiblingRules = true;
            break;
          }
        }
      }
      this.matchEpoch++;
      this.matchCache.clear();
      this.retiredChains.length = 0;
      this.retiredHead = 0;
      this.retiredSet.clear();
      for (const id of this.states.keys()) this.mark(id);
      this.scheduleFlush();
    }
    /** Registers an element created by the renderer. `tag` is the ORIGINAL
     * tag the user wrote (div, span, ...) so CSS selectors match it. `rawText`
     * marks a text element the renderer synthesized for bare string content
     * (`createText`), as opposed to an explicit `<text>` the page wrote: raw
     * text is a real element in the fjs tree but a plain text node in the
     * browser DOM, so it must not count for `:first-child`/`:last-child`
     * position (see the plan's two mixing cases). */
    ensure(id, tag, defaults, rawText) {
      var _a4;
      if (this.states.has(id)) return;
      let defaultsId = 0;
      if (defaults) {
        defaultsId = (_a4 = this.defaultsIds.get(defaults)) != null ? _a4 : 0;
        if (defaultsId === 0) {
          defaultsId = this.nextObjId++;
          this.defaultsIds.set(defaults, defaultsId);
        }
      }
      this.states.set(id, {
        tag,
        classes: /* @__PURE__ */ new Set(),
        scopes: /* @__PURE__ */ new Set(),
        defaults,
        defaultsId,
        rawText
      });
      this.mark(id);
      this.scheduleFlush();
    }
    /** The host's window (logical pixels) changed — width, height, or both.
     * Media conditions are not part of any element's chain key, so no
     * per-element cache can see the change; the invalidation has to be the
     * same whole-store sweep a stylesheet change does (bump the match epoch,
     * drop the cache, re-mark everything). A finer-grained pass — recompute
     * only elements whose matched set actually changed — was considered and
     * rejected (plan §3): finding that set is itself a scan over every rule
     * against the new viewport, so the saving would be the cache rebuild
     * only, at the cost of a second code path to keep correct. Desktop
     * window-dragging fires this per frame; the flush coalesces per
     * microtask, so it is one full recompute per frame — measured on the
     * responsive example before optimizing further. */
    setViewport(width, height) {
      if (width === this.viewport.width && height === this.viewport.height) return;
      this.viewport.width = width;
      this.viewport.height = height;
      if (!this.hasMedia) return;
      this.matchEpoch++;
      this.matchCache.clear();
      this.retiredChains.length = 0;
      this.retiredHead = 0;
      this.retiredSet.clear();
      for (const id of this.states.keys()) this.mark(id);
      this.scheduleFlush();
    }
    /** Sibling structure changed under `parentId` (insert / remove / v-for
     * move): every child's `:first-child`/`:last-child` position may have
     * flipped, and with `A + B` rules in play so may everyone's "previous
     * sibling". Marks the registered children; each recompute compares fresh
     * position bits / sibling signature against the cached ones and only
     * elements that actually moved pay for a subtree re-key. No-op while no
     * structural or sibling rules exist. */
    noteStructureChange(parentId) {
      if (!this.hasStructural && !this.hasSiblingRules) return;
      const kids = this.childrenOf.get(parentId);
      if (kids === void 0) return;
      for (let i = 0; i < kids.length; i++) this.mark(kids[i]);
      this.scheduleFlush();
    }
    /** @internal Test/diagnostic view of cache sizes. */
    cacheStatsForTest() {
      let byParent = 0;
      for (const m of this.matchCache.values()) byParent += m.byParent.size;
      return {
        matchCache: this.matchCache.size,
        chainIds: this.chainIds.size,
        byParent
      };
    }
    forget(id) {
      const s = this.states.get(id);
      if (!s) return;
      this.releaseChain(s);
      this.states.delete(id);
    }
    setClasses(id, value) {
      const s = this.states.get(id);
      if (!s) return;
      const classes = parseClassValue(value);
      classes.delete(DISABLED_CLASS);
      if (s.classes.has(DISABLED_CLASS)) classes.add(DISABLED_CLASS);
      this.replaceClasses(id, s, classes);
    }
    /** `:disabled` state of a form control (the renderer's `disabled` prop).
     * CSS only lets form controls be `:disabled`; a `disabled` attribute on a
     * div matches nothing, so other tags are ignored here too. */
    setDisabled(id, disabled) {
      const s = this.states.get(id);
      if (!s || !DISABLEABLE_TAGS.has(s.tag) || s.classes.has(DISABLED_CLASS) === disabled) return;
      const classes = new Set(s.classes);
      if (disabled) classes.add(DISABLED_CLASS);
      else classes.delete(DISABLED_CLASS);
      this.replaceClasses(id, s, classes);
    }
    replaceClasses(id, s, classes) {
      if (sameSet(classes, s.classes)) return;
      s.classes = classes;
      s.selfSig = void 0;
      this.markDirty(id, true);
      this.markNextSibling(id);
    }
    /** The element's current class list. The Transition shim reads it to add /
     * remove its `-enter-*` / `-leave-*` classes without losing whatever the
     * renderer last patched in (setClasses replaces the list). */
    classesOf(id) {
      const s = this.states.get(id);
      return s ? [...s.classes].filter((c) => c !== DISABLED_CLASS) : [];
    }
    /** DevTools (spec 092): the registered rules that match this element right
     * now — selector source text, which selectors matched (indices into
     * `selectors`), and the rule's declarations — in cascade order (weakest
     * first, so the panel's last row is the winner). Runs the same candidate
     * walk the match cache populates, on demand for ONE element at human click
     * cadence: nothing is cached and the compute hot path is untouched.
     * `:active` / `:hover` selectors match structurally but never "apply"
     * while the state is off, so they are reported as not-matching (a rule
     * that only has state selectors is left out entirely). */
    matchedRulesOf(id) {
      const s = this.states.get(id);
      if (!s) return [];
      const stamp = ++this.bucketEpoch;
      const hits = [];
      const walk = (bucket) => {
        if (bucket === void 0) return;
        for (const rule of bucket) {
          if (rule.bucketStamp === stamp) continue;
          rule.bucketStamp = stamp;
          if (rule.media !== void 0 && !mediaMatches(rule.media, this.viewport.width, this.viewport.height)) {
            continue;
          }
          const matched = [];
          let spec = -1;
          rule.selectors.forEach((sel, i) => {
            if (sel.pseudo || sel.active || sel.hover) return;
            if (rule.scope != null) {
              const has = sel.deep ? this.hasScopeUp(id, rule.scope) : s.scopes.has(rule.scope);
              if (!has) return;
            }
            if (!this.matchSelector(sel, id)) return;
            matched.push(i);
            spec = Math.max(spec, sel.specificity);
          });
          if (matched.length !== 0) hits.push({ rule, matched, spec });
        }
      };
      for (const cls of s.classes) walk(this.plainBuckets.byClass.get(cls));
      walk(this.plainBuckets.byTag.get(s.tag));
      walk(this.plainBuckets.catchAll);
      hits.sort((a, b) => a.spec - b.spec || a.rule.order - b.rule.order);
      return hits.map(({ rule, matched }) => ({
        selectors: rule.selectors.map((sel) => {
          var _a4;
          return (_a4 = sel.text) != null ? _a4 : "";
        }),
        matched,
        decls: rule.decls
      }));
    }
    /** The element's computed style, or undefined before the first compute.
     * The Transition shim reads `animationDuration` / `animationDelay` off it
     * to time the class removal — there are no DOM transitionend events on
     * this side to listen for. */
    computedOf(id) {
      var _a4;
      return (_a4 = this.states.get(id)) == null ? void 0 : _a4.computed;
    }
    setInlineStyle(id, value) {
      const s = this.states.get(id);
      if (!s) return;
      const { style, custom } = normalizeInline(value);
      if (sameMap(style, s.inline) && sameMap(custom, s.inlineCustom)) return;
      s.inline = style;
      s.inlineCustom = custom;
      this.markDirty(id, true);
    }
    /** The DOM's patchStyle semantics for a `:style` re-patch: an object
     * binding DIFFS against its previous value (set the next keys, drop the
     * keys that disappeared), so a key the binding did not change keeps
     * whatever wrote it in between — on a real DOM that is what makes
     * `el.style` writes from a library like @vueuse/motion survive a parent
     * re-render, and the shim needs the same here. A css string or a clear
     * replaces wholesale, like cssText. */
    patchInlineStyle(id, prev, next) {
      var _a4, _b3, _c, _d;
      const s = this.states.get(id);
      if (!s) return;
      if (typeof next !== "object" || next === null) {
        if (next == null) {
          const { style, custom: custom2 } = normalizeInline(prev);
          if (!style && !custom2) return;
          const inline2 = { ...(_a4 = s.inline) != null ? _a4 : {} };
          const inlineCustom = { ...(_b3 = s.inlineCustom) != null ? _b3 : {} };
          for (const key of Object.keys(style != null ? style : {})) delete inline2[key];
          for (const key of Object.keys(custom2 != null ? custom2 : {})) delete inlineCustom[normalizeVarKey(key)];
          if (sameMap(inline2, s.inline) && sameMap(inlineCustom, s.inlineCustom)) return;
          s.inline = inline2;
          s.inlineCustom = inlineCustom;
          this.markDirty(id, true);
        } else {
          this.setInlineStyle(id, next);
        }
        return;
      }
      const { style: prevStyle, custom: prevCustom } = normalizeInline(prev);
      const { style: nextStyle, custom: nextCustom } = normalizeInline(next);
      const inline = { ...(_c = s.inline) != null ? _c : {}, ...nextStyle };
      const custom = { ...(_d = s.inlineCustom) != null ? _d : {}, ...nextCustom };
      for (const key of Object.keys(prevStyle != null ? prevStyle : {})) {
        if (!(key in (nextStyle != null ? nextStyle : {}))) delete inline[key];
      }
      for (const key of Object.keys(prevCustom != null ? prevCustom : {})) {
        if (!(key in (nextCustom != null ? nextCustom : {}))) delete custom[key];
      }
      if (sameMap(inline, s.inline) && sameMap(custom, s.inlineCustom)) return;
      s.inline = inline;
      s.inlineCustom = custom;
      this.markDirty(id, true);
    }
    /** The element's current inline layer, for the DOM-shaped `el.style` shim
     * to read back (ui/element.ts). Inline properties plus the `--`-prefixed
     * custom ones; this is the WRITE record, not the resolved cascade — the
     * DOM's getComputedStyle semantics are out of scope for the shim. */
    inlineRecord(id) {
      const s = this.states.get(id);
      if (!s) return void 0;
      if (!s.inline && !s.inlineCustom) return void 0;
      return { ...s.inline, ...s.inlineCustom };
    }
    /** One-property write on the inline layer, same contract as a `:style`
     * object key (camelCase or kebab, custom props with `--`). `null`/`''`
     * removes. This is what `el.style[key] = v` funnels into, so a DOM
     * library, a `:style` binding and useCssVars all merge into one record
     * and re-resolve together instead of clobbering each other. */
    mutateInline(id, key, value) {
      var _a4, _b3;
      const s = this.states.get(id);
      if (!s) {
        warnOnce2(
          `el.style write for element #${id} ignored: the element was never registered with the style engine (raw element API?)`
        );
        return;
      }
      const inline = { ...(_a4 = s.inline) != null ? _a4 : {} };
      const custom = { ...(_b3 = s.inlineCustom) != null ? _b3 : {} };
      if (key.startsWith("--")) {
        const name = normalizeVarKey(key);
        if (value == null || value === "") delete custom[name];
        else custom[name] = String(value);
      } else if (value == null || value === "") {
        delete inline[key];
      } else {
        inline[key] = value;
      }
      if (sameMap(inline, s.inline) && sameMap(custom, s.inlineCustom)) return;
      s.inline = inline;
      s.inlineCustom = custom;
      this.markDirty(id, true);
    }
    /** Called via the renderer's setScopeId hook: Vue marks every element of
     * a component whose SFC has <style scoped> with its data-v-xxx id. */
    addScope(id, scope) {
      const s = this.states.get(id);
      if (!s || s.scopes.has(scope)) return;
      s.scopes.add(scope);
      s.selfSig = void 0;
      this.markDirty(id, true);
      this.markNextSibling(id);
    }
    /** Merges a useCssVars() batch into the element's inline custom props
     * (keys without the leading `--` are normalized; null/'' removes). */
    setInlineCustomProps(id, vars) {
      var _a4;
      const s = this.states.get(id);
      if (!s) return;
      const next = { ...(_a4 = s.inlineCustom) != null ? _a4 : {} };
      let changed = false;
      for (const [k, v] of Object.entries(vars)) {
        const name = normalizeVarKey(k.startsWith("--") ? k : `--${k}`);
        if (v == null || v === "") {
          if (name in next) {
            delete next[name];
            changed = true;
          }
          continue;
        }
        const val = String(v);
        if (next[name] !== val) {
          next[name] = val;
          changed = true;
        }
      }
      if (!changed && sameMap(next, s.inlineCustom)) return;
      s.inlineCustom = next;
      this.markDirty(id, true);
    }
    /** Marks `id` (and optionally its subtree) for recomputation and queues a
     * single microtask flush. Mounting touches each element several times
     * (create → addScope → class → insert); coalescing turns that from
     * O(touches × subtree) recomputes into one pass per element. */
    /** Adds an element to the pending set, once. */
    mark(id) {
      const state = this.states.get(id);
      if (state === void 0 || state.dirtyEpoch === this.dirtyEpoch) return;
      state.dirtyEpoch = this.dirtyEpoch;
      this.dirtyList.push(id);
    }
    markDirty(id, subtree) {
      var _a4, _b3;
      if (subtree) {
        const clock = (_b3 = (_a4 = globalThis.__fjs) == null ? void 0 : _a4.fns) == null ? void 0 : _b3.nowMs;
        const t0 = clock ? clock() : 0;
        const stack = this.walkStack;
        stack.length = 0;
        stack.push(id);
        let visited = 0;
        const cap = (this.parentOf.size + this.states.size) * 2 + 1024;
        while (stack.length > 0) {
          const nid = stack.pop();
          if (++visited > cap) {
            warnOnce2("style: subtree walk hit its visit cap (cyclic tree?)");
            break;
          }
          this.mark(nid);
          const kids = this.childrenOf.get(nid);
          if (kids !== void 0) {
            for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
          }
        }
        this.counters.markVisited += visited;
        if (clock) this.counters.markMs += clock() - t0;
        this.counters.markCalls++;
      } else {
        this.mark(id);
      }
      this.scheduleFlush();
    }
    /** Same semantics as before (kept for external callers), but the recompute
     * itself is now coalesced into the next microtask flush. */
    recomputeSubtree(id) {
      this.markDirty(id, true);
    }
    scheduleFlush() {
      if (this.flushQueued) return;
      this.flushQueued = true;
      Promise.resolve().then(() => this.flushPending());
    }
    /** Recomputes everything marked dirty, now. The microtask above does it
     * for ordinary batching; the host flush calls it too (renderer.ts
     * registerPreFlush), so ops never leave with the styles of elements they
     * create still pending — a forced layout read (getBoundingClientRect
     * flushes first) would otherwise lay those elements out unstyled: vant's
     * swipe measured the full 402px screen before its parents' paddings. */
    flushPending() {
      var _a4, _b3;
      this.flushQueued = false;
      if (!this.dirtyList.length) return;
      const clock = (_b3 = (_a4 = globalThis.__fjs) == null ? void 0 : _a4.fns) == null ? void 0 : _b3.nowMs;
      const t0 = clock ? clock() : 0;
      let guard = 0;
      while (this.dirtyList.length && guard++ < 100) {
        const ids = this.dirtyList;
        this.dirtyList = [];
        this.dirtyEpoch++;
        ids.sort((a, b) => a - b);
        for (let i = 0; i < ids.length; i++) this.recompute(ids[i]);
      }
      if (clock) this.counters.flushMs += clock() - t0;
      this.counters.flushes++;
    }
    recompute(id) {
      const s = this.states.get(id);
      if (!s) return;
      this.counters.recompute++;
      const merged = this.compute(id);
      s.computed = merged;
      const active = s.activeComputed;
      const hover = s.hoverComputed;
      let pseudoNote;
      if (s.pseudo !== s.pseudoApplied) {
        if (s.pseudo === void 0) pseudoNote = null;
        else if (s.pseudoApplied === void 0 || pseudoChanged(s.pseudo, s.pseudoApplied)) {
          pseudoNote = s.pseudo;
        }
      }
      s.pseudoApplied = s.pseudo;
      if (merged === s.applied && active === s.appliedActive && hover === s.appliedHover && pseudoNote === void 0) return;
      if (pseudoNote === void 0 && s.applied !== void 0 && sameStyle(merged, s.computedKeys, s.applied, s.appliedKeys) && sameOptionalStyle(active, s.activeKeys, s.appliedActive, s.appliedActiveKeys) && sameOptionalStyle(hover, s.hoverKeys, s.appliedHover, s.appliedHoverKeys)) {
        return;
      }
      this.counters.applied++;
      s.applied = merged;
      s.appliedKeys = s.computedKeys;
      s.appliedActive = active;
      s.appliedActiveKeys = s.activeKeys;
      s.appliedHover = hover;
      s.appliedHoverKeys = s.hoverKeys;
      this.applyStyle(id, merged, active != null ? active : null, s.hadHover ? hover != null ? hover : null : void 0, pseudoNote);
    }
    /** Hands the peer the frames of every animation the style names, as
     * `animationKeyframes: {name: [{offset, style}]}` — it runs them natively
     * (css/animation.ts). A name with no `@keyframes` block is left out, which
     * the peer reads as "no animation", as CSS does. */
    attachKeyframes(style, custom) {
      const names = style.animationName;
      if (typeof names !== "string" || this.keyframes.size === 0) return;
      let out;
      for (const raw of names.split(",")) {
        const name = raw.trim();
        if (!name || name === "none") continue;
        const block = this.keyframes.get(name);
        if (!block) continue;
        let frames = this.keyframesStatic.get(name);
        if (!frames) {
          let dynamic = false;
          frames = block.frames.map(({ offset, decls }) => {
            const resolved = resolveVars(decls, custom);
            if (resolved !== decls) dynamic = true;
            return { offset, style: resolved };
          });
          if (!dynamic) this.keyframesStatic.set(name, frames);
        }
        (out != null ? out : out = {})[name] = frames;
      }
      if (out) style.animationKeyframes = out;
    }
    compute(id) {
      var _a4, _b3;
      const s = this.states.get(id);
      if (!s) return {};
      const pid = this.parentOf.get(id);
      const parent = pid != null ? this.states.get(pid) : void 0;
      const parentComputed = parent == null ? void 0 : parent.computed;
      const parentCustom = parentComputed ? parent.custom : this.rootCustom;
      const matched = this.matchRules(id, s);
      const memoizable = s.inline === void 0 && s.inlineCustom === void 0;
      const parentStyleId = parentComputed ? parent.computedId : 0;
      if (memoizable) {
        const hit = matched.byParent.get(parentStyleId);
        if (hit && hit.defaultsId === ((_a4 = s.defaultsId) != null ? _a4 : 0)) {
          this.counters.computeHit++;
          s.custom = hit.custom;
          s.computedId = hit.styleId;
          s.customId = hit.customId;
          s.activeComputed = hit.activeStyle;
          s.computedKeys = hit.keys;
          s.activeKeys = hit.activeKeys;
          s.hoverComputed = hit.hoverStyle;
          s.hoverKeys = hit.hoverKeys;
          s.pseudo = hit.pseudo;
          if (hit.hoverStyle) s.hadHover = true;
          return hit.style;
        }
      }
      this.counters.computeMiss++;
      const copyInherited = (out) => {
        if (!parentComputed) return;
        for (let i = 0; i < INHERITABLE_KEYS.length; i++) {
          const k = INHERITABLE_KEYS[i];
          const v = parentComputed[k];
          if (v !== void 0) out[k] = v;
        }
        const deco = parentComputed.textDecoration;
        if (deco !== void 0 && (s.rawText || s.tag === "span")) out.textDecoration = deco;
        const clip = parentComputed.textOverflow;
        if (clip !== void 0 && s.rawText) out.textOverflow = clip;
      };
      const overlayCascade = (decls) => {
        const out = {};
        copyInherited(out);
        if (s.defaults) for (const k in s.defaults) out[k] = s.defaults[k];
        for (const k in decls) out[k] = decls[k];
        if (s.inline) for (const k in s.inline) out[k] = s.inline[k];
        return out;
      };
      const merged = {};
      copyInherited(merged);
      const hasParentCustom = hasKeys(parentCustom);
      const hasMatchedCustom = hasKeys(matched.custom);
      const hasInlineCustom = hasKeys(s.inlineCustom);
      const customSources = (hasParentCustom ? 1 : 0) + (hasMatchedCustom ? 1 : 0) + (hasInlineCustom ? 1 : 0);
      let custom;
      if (customSources === 1) {
        custom = hasParentCustom ? parentCustom : hasMatchedCustom ? matched.custom : s.inlineCustom;
      } else if (customSources > 1) {
        custom = {};
        if (hasParentCustom) for (const k in parentCustom) custom[k] = parentCustom[k];
        if (hasMatchedCustom) for (const k in matched.custom) custom[k] = matched.custom[k];
        if (hasInlineCustom) for (const k in s.inlineCustom) custom[k] = s.inlineCustom[k];
      }
      s.custom = custom;
      if (s.defaults) for (const k in s.defaults) merged[k] = s.defaults[k];
      for (const k in matched.decls) merged[k] = matched.decls[k];
      if (s.inline) for (const k in s.inline) merged[k] = s.inline[k];
      if (merged.flexDirection === void 0 && FLEX_DISPLAYS.has(merged.display)) {
        merged.flexDirection = "row";
        if (merged.alignItems === void 0) merged.alignItems = "stretch";
        if (merged.display === "inline-flex" && merged.flexWrap === void 0) {
          merged.flexWrap = "wrap";
        }
      }
      if ((merged.display === "inline-block" || merged.display === "inline") && merged.flexDirection === void 0 && merged.flexWrap === void 0) {
        merged.flexDirection = "row";
        merged.flexWrap = "wrap";
      }
      resolveInheritKeyword(merged, parentComputed);
      const parentFontPx = fontSizePx(parentComputed == null ? void 0 : parentComputed.fontSize, INITIAL_FONT_PX);
      const style = resolveVars(merged, custom);
      resolveEm(style, parentFontPx);
      this.attachKeyframes(style, custom);
      s.activeComputed = matched.activeDecls ? resolveVars(overlayCascade(matched.activeDecls), custom) : void 0;
      if (s.activeComputed) resolveEm(s.activeComputed, parentFontPx);
      s.hoverComputed = matched.hoverDecls ? resolveVars(overlayCascade(matched.hoverDecls), custom) : void 0;
      if (s.hoverComputed) resolveEm(s.hoverComputed, parentFontPx);
      if (matched.beforeDecls !== void 0 || matched.afterDecls !== void 0) {
        const inheritable = {};
        for (let i = 0; i < INHERITABLE_KEYS.length; i++) {
          const k = INHERITABLE_KEYS[i];
          const v = style[k];
          if (v !== void 0) inheritable[k] = v;
        }
        const build = (decls) => {
          const merged0 = resolveVars({ ...inheritable, ...decls }, custom);
          resolveEm(merged0, parentFontPx);
          resolveInheritKeyword(merged0, style);
          const color = merged0.color;
          if (typeof color === "string") {
            for (const k in merged0) {
              const v = merged0[k];
              if (typeof v === "string" && v.includes("currentColor")) {
                merged0[k] = v.replace(/currentcolor/gi, color);
              }
            }
          }
          return merged0;
        };
        const pseudo = {};
        if (matched.beforeDecls !== void 0) pseudo.before = build(matched.beforeDecls);
        if (matched.afterDecls !== void 0) pseudo.after = build(matched.afterDecls);
        s.pseudo = pseudo;
      } else {
        s.pseudo = void 0;
      }
      if (s.hoverComputed) s.hadHover = true;
      s.computedId = this.nextObjId++;
      s.customId = custom ? this.nextObjId++ : 0;
      s.computedKeys = Object.keys(style);
      s.activeKeys = s.activeComputed ? Object.keys(s.activeComputed) : void 0;
      s.hoverKeys = s.hoverComputed ? Object.keys(s.hoverComputed) : void 0;
      if (memoizable) {
        if (matched.byParent.size > 64) matched.byParent.clear();
        matched.byParent.set(parentStyleId, {
          style,
          keys: s.computedKeys,
          activeStyle: s.activeComputed,
          activeKeys: s.activeKeys,
          hoverStyle: s.hoverComputed,
          hoverKeys: s.hoverKeys,
          custom,
          pseudo: s.pseudo,
          styleId: s.computedId,
          customId: s.customId,
          defaultsId: (_b3 = s.defaultsId) != null ? _b3 : 0
        });
      }
      return style;
    }
    /** Rebuilds the matching-relevant signature of self + the ancestor chain
     * (tags/classes/scopes). Two elements with equal chainKeys see exactly
     * the same rule set, so their matchRules results are interchangeable. */
    buildChainKey(id, s) {
      var _a4;
      const pid = this.parentOf.get(id);
      const parent = pid != null ? this.states.get(pid) : void 0;
      const parentId = (_a4 = parent == null ? void 0 : parent.chainId) != null ? _a4 : 0;
      let sig = s.selfSig;
      if (sig === void 0) {
        sig = `${s.tag}${joinSorted(s.classes)}${joinSorted(s.scopes)}`;
        if (this.hasStructural) sig += `${this.structuralBits(id, s)}`;
        s.selfSig = sig;
      }
      if (this.hasSiblingRules) sig += `${this.prevSiblingSig(id)}`;
      return `${parentId}${sig}`;
    }
    /** Bit 0 = last child, bit 1 = first child, among the parent's children
     * that participate in structural position: registered (v-if comment
     * anchors are not) and not raw-text elements. A parentless element is
     * both — on web the page root is `#app`'s first (and last) child. */
    structuralBits(id, s) {
      const pid = this.parentOf.get(id);
      if (pid == null) return 3;
      const kids = this.childrenOf.get(pid);
      if (kids === void 0) return 3;
      let bits = 0;
      for (let i = 0; i < kids.length; i++) {
        if (kids[i] === id) {
          bits |= 2;
          break;
        }
        const k = this.states.get(kids[i]);
        if (k !== void 0 && !k.rawText) break;
      }
      for (let i = kids.length - 1; i >= 0; i--) {
        if (kids[i] === id) {
          bits |= 1;
          break;
        }
        const k = this.states.get(kids[i]);
        if (k !== void 0 && !k.rawText) break;
      }
      return bits;
    }
    /** The previous sibling that participates in structural position
     * (registered, not raw text) — the element an `A + B` selector matches
     * against. Null when there is none. */
    prevElementSibling(id) {
      const pid = this.parentOf.get(id);
      if (pid == null) return null;
      const kids = this.childrenOf.get(pid);
      if (kids === void 0) return null;
      let at = -1;
      for (let i = 0; i < kids.length; i++) {
        if (kids[i] === id) {
          at = i;
          break;
        }
      }
      if (at < 0) return null;
      for (let i = at - 1; i >= 0; i--) {
        const k = this.states.get(kids[i]);
        if (k !== void 0 && !k.rawText) return kids[i];
      }
      return null;
    }
    /** The previous sibling's matching signature ('' when there is none) —
     * what a `+` combinator compares and the chain key embeds. */
    prevSiblingSig(id) {
      const prev = this.prevElementSibling(id);
      if (prev == null) return "";
      const ps = this.states.get(prev);
      if (!ps) return "";
      let sig = `${ps.tag}${joinSorted(ps.classes)}${joinSorted(ps.scopes)}`;
      if (this.hasStructural) sig += `${this.structuralBits(prev, ps)}`;
      return sig;
    }
    /** Wakes the next participating sibling: `.a + .b` makes this element's
     * classes matching-relevant for the neighbor that follows. */
    markNextSibling(id) {
      if (!this.hasSiblingRules) return;
      const pid = this.parentOf.get(id);
      if (pid == null) return;
      const kids = this.childrenOf.get(pid);
      if (kids === void 0) return;
      let past = false;
      for (let i = 0; i < kids.length; i++) {
        if (kids[i] === id) {
          past = true;
          continue;
        }
        if (!past) continue;
        const k = this.states.get(kids[i]);
        if (k !== void 0 && !k.rawText) {
          this.mark(kids[i]);
          return;
        }
      }
      this.scheduleFlush();
    }
    matchRules(id, s) {
      var _a4, _b3;
      const pid = this.parentOf.get(id);
      const parentChainId = (_b3 = pid != null ? (_a4 = this.states.get(pid)) == null ? void 0 : _a4.chainId : 0) != null ? _b3 : 0;
      if (this.hasStructural) {
        const bits = this.structuralBits(id, s);
        if (s.structBits !== bits) {
          const firstBuild = s.selfSig === void 0;
          s.structBits = bits;
          s.selfSig = void 0;
          this.releaseChain(s);
          if (!firstBuild) this.markDirty(id, true);
        }
      }
      if (this.hasSiblingRules) {
        const sig = this.prevSiblingSig(id);
        if (s.prevSig !== sig) {
          const firstBuild = s.selfSig === void 0 && s.prevSig === void 0;
          s.prevSig = sig;
          this.releaseChain(s);
          if (!firstBuild) this.markDirty(id, false);
        }
      }
      if (s.matched !== void 0 && s.selfSig !== void 0 && s.matchedEpoch === this.matchEpoch && s.matchedParentChainId === parentChainId) {
        this.counters.matchHit++;
        return s.matched;
      }
      const key = this.buildChainKey(id, s);
      let chainId = this.chainIds.get(key);
      if (chainId === void 0) {
        chainId = this.nextChainId++;
        this.chainIds.set(key, chainId);
      }
      this.retainChain(s, key, chainId);
      const remember = (result2) => {
        s.matched = result2;
        s.matchedParentChainId = parentChainId;
        s.matchedEpoch = this.matchEpoch;
        return result2;
      };
      const cached = this.matchCache.get(key);
      if (cached) {
        this.counters.matchHit++;
        return remember(cached);
      }
      this.counters.matchMiss++;
      const plain = this.matchPlain;
      const active = this.matchActive;
      const hover = this.matchHover;
      plain.length = 0;
      active.length = 0;
      hover.length = 0;
      this.matchAnyActive = false;
      this.matchAnyHover = false;
      const stamp = ++this.bucketEpoch;
      for (const cls of s.classes) {
        this.scanPlainBucket(this.plainBuckets.byClass.get(cls), stamp, id, s, plain, active, hover);
      }
      this.scanPlainBucket(this.plainBuckets.byTag.get(s.tag), stamp, id, s, plain, active, hover);
      this.scanPlainBucket(this.plainBuckets.catchAll, stamp, id, s, plain, active, hover);
      const anyActive = this.matchAnyActive;
      const anyHover = this.matchAnyHover;
      const byCascade = (a, b) => a.spec - b.spec || a.rule.order - b.rule.order;
      plain.sort(byCascade);
      const decls = {};
      const custom = {};
      for (const m of plain) {
        const d = m.rule.decls;
        for (const k in d) {
          const v = d[k];
          if (k.startsWith("--")) custom[normalizeVarKey(k)] = String(v);
          else decls[k] = v;
        }
      }
      let activeDecls;
      if (anyActive) {
        active.sort(byCascade);
        activeDecls = {};
        for (const m of active) {
          const d = m.rule.decls;
          for (const k in d) {
            const v = d[k];
            if (!k.startsWith("--")) activeDecls[k] = v;
          }
        }
      }
      let hoverDecls;
      if (anyHover) {
        hover.sort(byCascade);
        hoverDecls = {};
        for (const m of hover) {
          const d = m.rule.decls;
          for (const k in d) {
            const v = d[k];
            if (!k.startsWith("--")) hoverDecls[k] = v;
          }
        }
      }
      let beforeDecls;
      let afterDecls;
      if (this.hasPseudo) {
        const before = [];
        const after = [];
        for (const cls of s.classes) {
          this.scanPseudoBucket(this.pseudoBuckets.byClass.get(cls), stamp, id, s, before, after);
        }
        this.scanPseudoBucket(this.pseudoBuckets.byTag.get(s.tag), stamp, id, s, before, after);
        this.scanPseudoBucket(this.pseudoBuckets.catchAll, stamp, id, s, before, after);
        const fold = (bucket) => {
          if (bucket.length === 0) return void 0;
          bucket.sort(byCascade);
          const out = {};
          for (const m of bucket) {
            const d = m.rule.decls;
            for (const k in d) {
              const v = d[k];
              if (!k.startsWith("--")) out[k] = v;
            }
          }
          return out;
        };
        beforeDecls = fold(before);
        afterDecls = fold(after);
      }
      const result = {
        decls,
        custom,
        activeDecls,
        hoverDecls,
        beforeDecls,
        afterDecls,
        id: this.nextObjId++,
        byParent: /* @__PURE__ */ new Map()
      };
      this.matchCache.set(key, result);
      return remember(result);
    }
    /** One candidate bucket of the plain scan — the body is the per-rule work
     * the full scan used to do, unchanged (media filter, scope check, selector
     * match, the three-cascade split). Kept as a method so the walk over an
     * element's class buckets + tag bucket + catch-all stays one loop per
     * bucket with no per-element allocation beyond the matches themselves. */
    scanPlainBucket(bucket, stamp, id, s, plain, active, hover) {
      if (bucket === void 0) return;
      for (const rule of bucket) {
        if (rule.bucketStamp === stamp) continue;
        rule.bucketStamp = stamp;
        if (rule.media !== void 0 && !mediaMatches(rule.media, this.viewport.width, this.viewport.height)) {
          continue;
        }
        let bestPlain = -1;
        let bestActive = -1;
        let bestHover = -1;
        for (const sel of rule.selectors) {
          if (rule.scope != null) {
            const has = sel.deep ? this.hasScopeUp(id, rule.scope) : s.scopes.has(rule.scope);
            if (!has) continue;
          }
          if (!this.matchSelector(sel, id)) continue;
          const spec = sel.specificity;
          if (!sel.active && !sel.hover) bestPlain = Math.max(bestPlain, spec);
          if (!sel.hover) bestActive = Math.max(bestActive, spec);
          if (!sel.active) bestHover = Math.max(bestHover, spec);
        }
        const best = Math.max(bestPlain, bestActive, bestHover);
        if (best < 0) continue;
        const bump = rule.scope != null ? 10 : 0;
        if (bestPlain >= 0) plain.push({ rule, spec: bestPlain + bump });
        if (bestActive >= 0) active.push({ rule, spec: bestActive + bump });
        if (bestHover >= 0) hover.push({ rule, spec: bestHover + bump });
        if (bestActive > bestPlain) this.matchAnyActive = true;
        if (bestHover > bestPlain) this.matchAnyHover = true;
      }
    }
    /** Same walk for the `::before`/`::after` rule set: per-rule body is the
     * old pseudo scan verbatim, cascaded per pseudo kind by the caller. */
    scanPseudoBucket(bucket, stamp, id, s, before, after) {
      if (bucket === void 0) return;
      for (const rule of bucket) {
        if (rule.bucketStamp === stamp) continue;
        rule.bucketStamp = stamp;
        if (rule.media !== void 0 && !mediaMatches(rule.media, this.viewport.width, this.viewport.height)) {
          continue;
        }
        let best = -1;
        for (const sel of rule.selectors) {
          if (rule.scope != null) {
            const has = sel.deep ? this.hasScopeUp(id, rule.scope) : s.scopes.has(rule.scope);
            if (!has) continue;
          }
          if (!this.matchSelector(sel, id)) continue;
          best = Math.max(best, sel.specificity);
        }
        if (best < 0) continue;
        const spec = best + (rule.scope != null ? 10 : 0);
        (rule.pseudo === "before" ? before : after).push({ rule, spec });
      }
    }
    retainChain(s, key, chainId) {
      var _a4;
      if (s.chainKey === key) return;
      this.releaseChain(s);
      s.chainKey = key;
      s.chainId = chainId;
      this.chainRefs.set(key, ((_a4 = this.chainRefs.get(key)) != null ? _a4 : 0) + 1);
    }
    releaseChain(s) {
      var _a4;
      const key = s.chainKey;
      if (key === void 0) return;
      const refs = ((_a4 = this.chainRefs.get(key)) != null ? _a4 : 1) - 1;
      if (refs <= 0) {
        this.chainRefs.delete(key);
        if (!this.retiredSet.has(key)) {
          this.retiredSet.add(key);
          this.retiredChains.push(key);
        }
        if (this.retiredChains.length - this.retiredHead > RETIRED_CHAIN_LIMIT) {
          this.trimRetiredChains();
        }
      } else {
        this.chainRefs.set(key, refs);
      }
      s.chainKey = void 0;
      s.chainId = void 0;
      s.matched = void 0;
      s.matchedParentChainId = void 0;
      s.matchedEpoch = void 0;
    }
    /** Evicts oldest retired chains past the cap. A key that was
     * re-referenced since retiring (chainRefs has it again) is skipped and
     * simply dropped from the queue — its id and cache stay live; it re-joins
     * the queue if it dies again. */
    trimRetiredChains() {
      while (this.retiredChains.length - this.retiredHead > RETIRED_CHAIN_LIMIT) {
        const key = this.retiredChains[this.retiredHead++];
        this.retiredSet.delete(key);
        if (this.chainRefs.get(key) === void 0) {
          this.chainIds.delete(key);
          this.matchCache.delete(key);
        }
      }
      if (this.retiredHead > 256 && this.retiredHead * 2 > this.retiredChains.length) {
        this.retiredChains.splice(0, this.retiredHead);
        this.retiredHead = 0;
      }
    }
    matchSelector(sel, id) {
      return this.matchCompoundFrom(sel, sel.compounds.length - 1, id);
    }
    matchCompoundFrom(sel, idx, id) {
      const s = this.states.get(id);
      if (!s) return false;
      const c = sel.compounds[idx];
      if (c.tag != null && s.tag !== c.tag) return false;
      for (const cls of c.classes) {
        if (!s.classes.has(cls)) return false;
      }
      if (c.classAttr && !c.classAttr.every((t) => matchClassAttr(t, s.classes))) return false;
      if (c.first || c.last || c.notFirst || c.notLast) {
        const bits = this.structuralBits(id, s);
        if (c.first && !(bits & 2)) return false;
        if (c.last && !(bits & 1)) return false;
        if (c.notFirst && bits & 2) return false;
        if (c.notLast && bits & 1) return false;
      }
      if (idx === 0) return true;
      const comb = sel.combinators[idx - 1];
      const pid = this.parentOf.get(id);
      if (pid == null) return false;
      if (comb === "child") return this.matchCompoundFrom(sel, idx - 1, pid);
      if (comb === "nextSibling") {
        const prev = this.prevElementSibling(id);
        return prev != null && this.matchCompoundFrom(sel, idx - 1, prev);
      }
      let cur = pid;
      while (cur != null) {
        if (this.matchCompoundFrom(sel, idx - 1, cur)) return true;
        cur = this.parentOf.get(cur);
      }
      return false;
    }
    hasScopeUp(id, scope) {
      var _a4;
      let cur = id;
      while (cur != null) {
        if ((_a4 = this.states.get(cur)) == null ? void 0 : _a4.scopes.has(scope)) return true;
        cur = this.parentOf.get(cur);
      }
      return false;
    }
  };
  function joinSorted(set) {
    if (set.size === 0) return "";
    if (set.size === 1) {
      for (const v of set) return v;
    }
    const out = [];
    for (const v of set) out.push(v);
    out.sort();
    return out.join("");
  }
  function parseClassValue(value) {
    let text = "";
    if (typeof value === "string") text = value;
    else if (Array.isArray(value)) text = value.filter((v) => typeof v === "string").join(" ");
    else if (value && typeof value === "object") {
      text = Object.entries(value).filter(([, on]) => on).map(([k]) => k).join(" ");
    }
    return new Set(text.split(/\s+/).filter(Boolean));
  }
  function sameSet(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  function normalizeVarKey(name) {
    return name.includes("\\") ? name.replace(/\\(.)/g, "$1") : name;
  }
  function resolveVarsInString(text, custom, depth) {
    if (depth > 32) return null;
    let out = "";
    let i = 0;
    while (i < text.length) {
      const idx = text.indexOf("var(", i);
      if (idx < 0) {
        out += text.slice(i);
        return out;
      }
      out += text.slice(i, idx);
      let paren = 1;
      let j = idx + 4;
      const argsStart = j;
      while (j < text.length && paren > 0) {
        const ch = text[j];
        if (ch === "(") paren++;
        else if (ch === ")") {
          paren--;
          if (paren === 0) break;
        }
        j++;
      }
      if (paren > 0) return null;
      const args = text.slice(argsStart, j);
      let d = 0;
      let comma = -1;
      for (let k = 0; k < args.length; k++) {
        const ch = args[k];
        if (ch === "(") d++;
        else if (ch === ")") d--;
        else if (ch === "," && d === 0) {
          comma = k;
          break;
        }
      }
      const name = (comma >= 0 ? args.slice(0, comma) : args).trim();
      const fallback = comma >= 0 ? args.slice(comma + 1).trim() : void 0;
      let val = Object.prototype.hasOwnProperty.call(custom, normalizeVarKey(name)) ? custom[normalizeVarKey(name)] : null;
      if (val != null) {
        val = resolveVarsInString(val, custom, depth + 1);
      } else if (fallback != null) {
        val = resolveVarsInString(fallback, custom, depth + 1);
      }
      if (val == null) return null;
      out += val;
      i = j + 1;
    }
    return out;
  }
  function resolveVars(style, custom) {
    let needed = false;
    for (const k in style) {
      const v = style[k];
      if (typeof v === "string" && v.includes("var(")) {
        needed = true;
        break;
      }
    }
    if (!needed) return style;
    let changed = false;
    const out = {};
    for (const [k, v] of Object.entries(style)) {
      if (typeof v === "string" && v.includes("var(")) {
        const resolved = resolveVarsInString(v, custom != null ? custom : {}, 0);
        if (resolved == null) {
          changed = true;
          continue;
        }
        const value = normalizeValue(k, resolved);
        changed = true;
        if (value !== void 0) out[k] = value;
      } else {
        out[k] = v;
      }
    }
    return changed ? out : style;
  }
  function sameStyle(a, aKeys, b, bKeys) {
    if (a === b) return true;
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      const k = aKeys[i];
      const va = a[k];
      const vb = b[k];
      if (va === vb) continue;
      if (va !== null && vb !== null && typeof va === "object" && typeof vb === "object") {
        if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
        continue;
      }
      return false;
    }
    return true;
  }
  function normalizeInline(value) {
    let style;
    let custom;
    if (typeof value === "string" && value.trim()) {
      const parsed = parseInlineCss(value);
      style = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (k.startsWith("--")) (custom != null ? custom : custom = {})[normalizeVarKey(k)] = String(v);
        else style[k] = v;
      }
    } else if (value && typeof value === "object") {
      style = {};
      for (const [k, v] of Object.entries(value)) {
        if (v == null || v === "") continue;
        if (k.startsWith("--")) (custom != null ? custom : custom = {})[normalizeVarKey(k)] = String(v);
        else style[k.includes("-") ? camelize(k) : k] = v;
      }
    }
    return { style, custom };
  }
  function sameMap(a, b) {
    if (a === b) return true;
    const ak = a ? Object.keys(a) : [];
    const bk = b ? Object.keys(b) : [];
    if (ak.length !== bk.length) return false;
    return sameStyle(a != null ? a : {}, ak, b != null ? b : {}, bk);
  }
  function sameOptionalStyle(a, aKeys, b, bKeys) {
    if (a === b) return true;
    if (a === void 0 || b === void 0) return false;
    return sameStyle(a, aKeys != null ? aKeys : [], b, bKeys != null ? bKeys : []);
  }

  // packages/fjs-runtime/src/vue/renderer.ts
  var EVENT_VIEWPORT_CHANGED = 33;
  registerSystemHandler(EVENT_VIEWPORT_CHANGED, (_id, payload) => {
    let wire;
    try {
      wire = JSON.parse(payload != null ? payload : "{}");
    } catch {
      return;
    }
    if (typeof wire.width === "number" && typeof wire.height === "number") {
      styleEngine.setViewport(wire.width, wire.height);
    }
  });
  var parentOf = /* @__PURE__ */ new Map();
  var childrenOf = /* @__PURE__ */ new Map();
  var htmlDefaults = /* @__PURE__ */ new Map();
  var elementsById = /* @__PURE__ */ new Map();
  var hoistedFrom = /* @__PURE__ */ new Map();
  var pageRoots = /* @__PURE__ */ new Map();
  var overlayHosts = /* @__PURE__ */ new Map();
  function pageRootOf(id) {
    for (let cur = id; cur != null; cur = parentOf.get(cur)) {
      const root = pageRoots.get(cur);
      if (root) return root;
    }
    let last;
    for (const root of pageRoots.values()) last = root;
    return last;
  }
  function ensureOverlayHost(pageRoot) {
    var _a4, _b3;
    const existing = overlayHosts.get(pageRoot.id);
    if (existing) return existing;
    const host2 = create("fjs-overlay-host");
    track(host2);
    setProps(host2, {
      style: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }
    });
    insert(pageRoot, host2);
    const at = (_b3 = (_a4 = childrenOf.get(pageRoot.id)) == null ? void 0 : _a4.length) != null ? _b3 : 0;
    trackInsert(pageRoot, host2, at);
    overlayHosts.set(pageRoot.id, host2);
    return host2;
  }
  function hoistIfNeeded(el, style) {
    var _a4, _b3, _c;
    if (style.position !== "fixed" || hoistedFrom.has(el.id)) return;
    const pageRoot = pageRootOf(el.id);
    if (!pageRoot) return;
    const host2 = ensureOverlayHost(pageRoot);
    const logical = (_a4 = parentOf.get(el.id)) != null ? _a4 : null;
    hoistedFrom.set(el.id, logical === host2.id ? null : logical);
    if (logical === host2.id) return;
    trackDetach(el);
    const at = (_c = (_b3 = childrenOf.get(host2.id)) == null ? void 0 : _b3.length) != null ? _c : 0;
    insert(host2, el, at);
    trackInsert(host2, el, at);
    styleEngine.recomputeSubtree(el.id);
  }
  var pseudoBoxes = /* @__PURE__ */ new Map();
  function unescapeCssContent(text) {
    return text.replace(
      /\\(?:([0-9a-fA-F]{1,6})\s?|(.))/g,
      (_, hex, ch) => hex ? String.fromCodePoint(parseInt(hex, 16)) : ch
    );
  }
  function isPrivateUseOnly(text) {
    if (text.length === 0) return false;
    return [...text].every((ch) => {
      const c = ch.codePointAt(0);
      return c >= 57344 && c <= 63743 || c >= 983040 && c <= 1048573 || c >= 1048576 && c <= 1114109;
    });
  }
  function pseudoContent(value, fontFamily) {
    if (value === void 0 || value === null) return null;
    const v = value.toString().trim();
    if (v === "none" || v === "normal") return null;
    const quoted = /^(["'])(.*)\1$/s.exec(v);
    if (!quoted) {
      if (/^[a-z-]+\(/.test(v)) {
        console.warn(
          `[fjs css] pseudo-element content "${v}" is not supported (only quoted strings / empty); box skipped`
        );
        return null;
      }
      return v;
    }
    const text = unescapeCssContent(quoted[2]);
    if (/^[ \t\n\r\f]*$/.test(text)) return "";
    return isPrivateUseOnly(text) && !usesDeclaredFont(fontFamily) ? "" : text;
  }
  var pseudoTexts = /* @__PURE__ */ new Map();
  function pseudoTextStyle(style) {
    const out = {};
    for (let i = 0; i < INHERITABLE_KEYS.length; i++) {
      const k = INHERITABLE_KEYS[i];
      if (style[k] !== void 0) out[k] = style[k];
    }
    return out;
  }
  function syncPseudoText(box, content, style) {
    const existing = pseudoTexts.get(box.id);
    if (!content) {
      if (existing) {
        remove(existing);
        elementsById.delete(existing.id);
        pseudoTexts.delete(box.id);
      }
      return;
    }
    if (existing) {
      setText(existing, content);
      setStyle(existing, pseudoTextStyle(style));
      return;
    }
    const text = create("text");
    setText(text, content);
    setStyle(text, pseudoTextStyle(style));
    elementsById.set(text.id, text);
    insert(box, text);
    pseudoTexts.set(box.id, text);
  }
  function dropPseudoBox(box) {
    pseudoTexts.delete(box.id);
    remove(box);
  }
  function syncPseudoBoxes(el, styles) {
    var _a4, _b3;
    if (styles === null) {
      for (const box of [(_a4 = pseudoBoxes.get(el.id)) == null ? void 0 : _a4.before, (_b3 = pseudoBoxes.get(el.id)) == null ? void 0 : _b3.after]) {
        if (box) dropPseudoBox(box);
      }
      pseudoBoxes.delete(el.id);
      return;
    }
    let entry = pseudoBoxes.get(el.id);
    if (!entry) pseudoBoxes.set(el.id, entry = {});
    for (const kind of ["before", "after"]) {
      const decls = styles[kind];
      const existing = entry[kind];
      if (decls === void 0) {
        if (existing) {
          dropPseudoBox(existing);
          delete entry[kind];
        }
        continue;
      }
      const content = pseudoContent(decls.content, decls.fontFamily);
      if (content === null) {
        if (existing) {
          dropPseudoBox(existing);
          delete entry[kind];
        }
        continue;
      }
      const style = { ...decls };
      delete style.content;
      if (!existing) {
        const box = create("view");
        elementsById.set(box.id, box);
        setStyle(box, style);
        syncPseudoText(box, content != null ? content : "", style);
        insert(el, box, kind === "before" ? 0 : void 0);
        entry[kind] = box;
      } else {
        setStyle(existing, style);
        syncPseudoText(existing, content != null ? content : "", style);
      }
    }
  }
  var styleEngine = new StyleEngine(parentOf, childrenOf, (id, style, activeStyle, hoverStyle, pseudo) => {
    const el = elementsById.get(id);
    if (!el) return;
    if (activeStyle === null && !hadActiveStyle.has(id)) {
      setStyle(el, style);
    } else {
      if (activeStyle) hadActiveStyle.add(id);
      else hadActiveStyle.delete(id);
      setStyle(el, style, activeStyle);
    }
    if (hoverStyle !== void 0) setHoverStyle(el, hoverStyle);
    if (pseudo !== void 0) syncPseudoBoxes(el, pseudo);
    if (style.position === "fixed") hoistIfNeeded(el, style);
  });
  registerPreFlush(() => styleEngine.flushPending());
  setElementStyleBridge({
    read: (id) => styleEngine.inlineRecord(id),
    write: (id, key, value) => styleEngine.mutateInline(id, key, value)
  });
  var _a3;
  if (hasNativeHost) {
    try {
      const wire = JSON.parse((_a3 = invokeHost("fjs.viewport.get")) != null ? _a3 : "{}");
      if (typeof wire.width === "number" && typeof wire.height === "number") {
        styleEngine.setViewport(wire.width, wire.height);
      }
    } catch {
    }
  }
  var hadActiveStyle = /* @__PURE__ */ new Set();
  var ANCHOR_STYLE = { display: "none" };
  function hostContains(other) {
    let id = other == null ? void 0 : other.id;
    if (typeof id !== "number" || !elementsById.has(id)) return false;
    while (id != null) {
      if (id === this.id) return true;
      id = parentOf.get(id);
    }
    return false;
  }
  var EVENT_GLOBAL_POINTER_DOWN = 43;
  var globalPointerListeners = /* @__PURE__ */ new Set();
  registerSystemHandler(EVENT_GLOBAL_POINTER_DOWN, (id, payload) => {
    var _a4, _b3, _c, _d;
    if (globalPointerListeners.size === 0) return;
    let x = 0;
    let y = 0;
    try {
      const p = JSON.parse(String(payload != null ? payload : "{}"));
      x = (_a4 = p.x) != null ? _a4 : 0;
      y = (_b3 = p.y) != null ? _b3 : 0;
    } catch {
    }
    const target = (_d = (_c = elementsById.get(id)) != null ? _c : pageRoots.get(id)) != null ? _d : null;
    for (const listener of [...globalPointerListeners]) listener({ target, clientX: x, clientY: y });
  });
  var POSITIONED = /* @__PURE__ */ new Set(["relative", "absolute", "fixed", "sticky"]);
  setOffsetParentResolver((id) => {
    var _a4, _b3, _c, _d;
    let cur = parentOf.get(id);
    let last = null;
    while (cur != null) {
      const position = (_a4 = styleEngine.computedOf(cur)) == null ? void 0 : _a4.position;
      if (typeof position === "string" && POSITIONED.has(position)) return (_b3 = elementsById.get(cur)) != null ? _b3 : null;
      last = cur;
      cur = parentOf.get(cur);
    }
    return last == null ? null : (_d = (_c = elementsById.get(last)) != null ? _c : pageRoots.get(last)) != null ? _d : null;
  });
  function track(el) {
    elementsById.set(el.id, el);
    el.contains = hostContains;
  }
  function trackDetach(child) {
    const parentId = parentOf.get(child.id);
    if (parentId == null) return;
    const list = childrenOf.get(parentId);
    const idx = list ? list.indexOf(child.id) : -1;
    if (idx >= 0) list.splice(idx, 1);
    parentOf.delete(child.id);
  }
  function trackInsert(parent, child, index) {
    var _a4;
    parentOf.set(child.id, parent.id);
    const list = (_a4 = childrenOf.get(parent.id)) != null ? _a4 : [];
    const at = Math.min(index, list.length);
    list.splice(at, 0, child.id);
    childrenOf.set(parent.id, list);
  }
  function forgetSubtree(id) {
    const stack = [id];
    while (stack.length) {
      const current = stack.pop();
      const kids = childrenOf.get(current);
      if (kids) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
      if (current !== id) {
        parentOf.delete(current);
        childrenOf.delete(current);
      }
      elementsById.delete(current);
      hadActiveStyle.delete(current);
      htmlDefaults.delete(current);
      textValues.delete(current);
      if (onceFired.size) {
        for (const key of onceFired) if (key.startsWith(`${current}:`)) onceFired.delete(key);
      }
      forgetElementStyle(current);
      forgetHandlers(current);
      styleEngine.forget(current);
    }
  }
  function trackRemove(child) {
    const parentId = parentOf.get(child.id);
    if (parentId != null) {
      const list = childrenOf.get(parentId);
      if (list) {
        const idx = list.indexOf(child.id);
        if (idx >= 0) list.splice(idx, 1);
      }
    }
    parentOf.delete(child.id);
    childrenOf.delete(child.id);
    hadActiveStyle.delete(child.id);
  }
  var H = {
    // containers. `flexShrink: 1` restores the CSS initial value the fjs tag
    // set deliberately lacks: base-css pins `view { flex-shrink: 0 }` so an
    // fjs view matches Flutter's keep-its-natural-size flex child, and the
    // Dart side (_noShrinkTags) keys the same pin off the MAPPED tag. A vant
    // `div` on the web stays a real DOM node with that initial, so e.g.
    // `.van-skeleton__content { width: 100% }` yields to a fixed-size avatar
    // there, while the mapped view held its width and pushed the row past the
    // edge (RIGHT OVERFLOWED BY 84px, spec 073). Defaults sit under matched
    // rules, so declared values — vant's own `flex-shrink: 0` on
    // `.van-skeleton-avatar` — still win. Mapped *text* tags keep the view
    // behavior: no known vant row competes on a definite-width text, and the
    // narrower default keeps already-accepted pages stable.
    div: { tag: "view", style: { flexShrink: 1 } },
    section: { tag: "view", style: { flexShrink: 1 } },
    main: { tag: "view", style: { flexShrink: 1 } },
    article: { tag: "view", style: { flexShrink: 1 } },
    aside: { tag: "view", style: { flexShrink: 1 } },
    nav: { tag: "view", style: { flexShrink: 1 } },
    header: { tag: "view", style: { flexShrink: 1 } },
    footer: { tag: "view", style: { flexShrink: 1 } },
    ul: { tag: "view", style: { flexShrink: 1 } },
    ol: { tag: "view", style: { flexShrink: 1 } },
    li: { tag: "view", style: { flexShrink: 1 } },
    // `label` is an fjs tag of its own now (it forwards taps); it stays in
    // this table so the defaults an HTML page relied on still apply, mapping
    // to itself. `form` is NOT here: on this path it resolves to the Vue
    // component in components/form.ts, which renders a plain view.
    table: { tag: "view", style: { flexShrink: 1 } },
    tr: { tag: "view", style: { flexDirection: "row", flexShrink: 1 } },
    td: { tag: "view", style: { flexShrink: 1 } },
    th: { tag: "view", style: { flexShrink: 1 } },
    // text
    span: { tag: "text" },
    p: { tag: "text", style: { margin: 8, fontSize: 15 } },
    b: { tag: "text", style: { fontWeight: "bold" } },
    strong: { tag: "text", style: { fontWeight: "bold" } },
    em: { tag: "text", style: { fontWeight: "500" } },
    i: { tag: "text", style: { fontWeight: "500" } },
    small: { tag: "text", style: { fontSize: 12 } },
    a: { tag: "text", style: { color: "#1a73e8" } },
    h1: { tag: "text", style: { fontSize: 28, fontWeight: "bold" } },
    h2: { tag: "text", style: { fontSize: 24, fontWeight: "bold" } },
    h3: { tag: "text", style: { fontSize: 20, fontWeight: "bold" } },
    h4: { tag: "text", style: { fontSize: 18, fontWeight: "600" } },
    h5: { tag: "text", style: { fontSize: 16, fontWeight: "600" } },
    h6: { tag: "text", style: { fontSize: 14, fontWeight: "600" } },
    br: { tag: "text" },
    // controls (map onto native widgets)
    img: { tag: "image" },
    // The button's chrome (padding / radius / hairline / label color) is a
    // Dart-side default now — widgets/button.dart — because a filled variant
    // (`type="primary"`) must NOT have the hairline, and a border injected
    // from here reaches Dart indistinguishable from one the page wrote.
    // A page's own `border: none` / `border-color: …` still wins, exactly as
    // before (render/style.dart resolves the two the way CSS does).
    button: { tag: "button" },
    input: { tag: "input" },
    // same numbers the web base stylesheet gives `label` (base-css.ts)
    label: { tag: "label", style: { margin: 4, fontSize: 14, color: "#666666" } },
    // `textarea` used to be an alias for `input multiline`. It is a real
    // component now (components/textarea.ts); an alias here would rewrite the
    // tag before the component is ever instantiated. A render function that
    // asks for the ELEMENT (`h('textarea')`, vant's Field) never meets the
    // component — createElement turns that one into the same multiline input.
    hr: { tag: "divider" }
  };
  var HTML_BLOCK_TAGS = /* @__PURE__ */ new Set([
    "div",
    "section",
    "main",
    "article",
    "aside",
    "nav",
    "header",
    "footer",
    "li",
    "td",
    "th",
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6"
  ]);
  var htmlTagCache = /* @__PURE__ */ new Map();
  function resolveHtmlTag(tag) {
    var _a4;
    const cached = htmlTagCache.get(tag);
    if (cached !== void 0) return cached;
    const m = H[tag];
    const resolved = m ? { tag: m.tag, defaults: { ...m.style ? { style: m.style } : {}, ...(_a4 = m.props) != null ? _a4 : {} } } : null;
    htmlTagCache.set(tag, resolved);
    return resolved;
  }
  function dropElement(child) {
    var _a4;
    const parentId = parentOf.get(child.id);
    const stack = [child.id];
    while (stack.length) {
      const current = stack.pop();
      const boxes = pseudoBoxes.get(current);
      if (boxes) {
        if (boxes.before) remove(boxes.before);
        if (boxes.after) remove(boxes.after);
        pseudoBoxes.delete(current);
      }
      for (const kid of (_a4 = childrenOf.get(current)) != null ? _a4 : []) stack.push(kid);
    }
    hoistedFrom.delete(child.id);
    forgetSubtree(child.id);
    trackRemove(child);
    remove(child);
    if (parentId != null) styleEngine.noteStructureChange(parentId);
  }
  function hoistedUnder(id) {
    var _a4;
    if (!hoistedFrom.size) return [];
    const out = [];
    const stack = [id];
    while (stack.length) {
      const current = stack.pop();
      for (const kid of (_a4 = childrenOf.get(current)) != null ? _a4 : []) stack.push(kid);
      for (const [el, from] of hoistedFrom) {
        if (from === current && el !== id) {
          out.push(el);
          stack.push(el);
        }
      }
    }
    return out;
  }
  var nodeOps = {
    createElement: (rawTag) => {
      const mapped = resolveHtmlTag(rawTag);
      const el = create(mapped ? mapped.tag : rawTag === "textarea" ? "input" : rawTag);
      if (rawTag === "textarea") {
        setProps(el, { multiline: true });
      }
      if (HTML_BLOCK_TAGS.has(rawTag)) setProps(el, { htmlBlock: true });
      if (mapped) {
        htmlDefaults.set(el.id, mapped.defaults);
        if (rawTag === "br") setText(el, "\n");
      }
      track(el);
      if (TEXT_CONTROL_TAGS.has(el.tag)) installTextControlValue(el);
      styleEngine.ensure(el.id, rawTag, mapped == null ? void 0 : mapped.defaults.style);
      childrenOf.set(el.id, []);
      parentOf.set(el.id, null);
      return el;
    },
    createText: (text) => {
      const el = create("text");
      if (text) setText(el, text);
      track(el);
      styleEngine.ensure(el.id, "text", void 0, true);
      return el;
    },
    insertStaticContent: (content) => {
      void content;
      throw new Error(
        "[fjs] createStaticVNode is not supported by the fjs renderer: static content mounts through DOM innerHTML semantics. Hand-written render functions must build regular vnodes (h/createVNode); SFC templates are already compiled with hoistStatic:false."
      );
    },
    createComment: (text) => {
      void text;
      const el = create("view");
      track(el);
      setProps(el, { style: ANCHOR_STYLE });
      return el;
    },
    setText: (node, text) => {
      setText(node, text);
      devtoolsSlots.recordText(node.id, text);
    },
    setElementText: (node, text) => {
      setText(node, text);
      devtoolsSlots.recordText(node.id, text);
    },
    insert: (child, parent, anchor) => {
      var _a4, _b3;
      trackDetach(child);
      let target = parent;
      if (hoistedFrom.has(child.id)) {
        hoistedFrom.set(child.id, parent.id);
        const pageRoot = pageRootOf(parent.id);
        if (pageRoot) target = ensureOverlayHost(pageRoot);
      }
      const siblings = (_a4 = childrenOf.get(target.id)) != null ? _a4 : [];
      let index = siblings.length;
      if (target === parent && anchor) {
        const ai = siblings.indexOf(anchor.id);
        if (ai >= 0) index = ai;
      }
      const beforeBoxes = target === parent ? ((_b3 = pseudoBoxes.get(parent.id)) == null ? void 0 : _b3.before) ? 1 : 0 : 0;
      insert(target, child, index + beforeBoxes);
      trackInsert(target, child, index);
      styleEngine.recomputeSubtree(child.id);
      styleEngine.noteStructureChange(target.id);
    },
    remove: (child) => {
      for (const id of hoistedUnder(child.id)) {
        const el = elementsById.get(id);
        if (el) dropElement(el);
      }
      dropElement(child);
    },
    parentNode: (node) => {
      var _a4;
      const parentId = parentOf.get(node.id);
      if (parentId == null) return null;
      return (_a4 = elementsById.get(parentId)) != null ? _a4 : makeHandle(parentId);
    },
    nextSibling: (node) => {
      var _a4, _b3;
      const parentId = parentOf.get(node.id);
      if (parentId == null) return null;
      const list = (_a4 = childrenOf.get(parentId)) != null ? _a4 : [];
      const idx = list.indexOf(node.id);
      if (idx < 0 || idx + 1 >= list.length) return null;
      return (_b3 = elementsById.get(list[idx + 1])) != null ? _b3 : makeHandle(list[idx + 1]);
    },
    querySelector: () => null,
    // not supported (no DOM)
    // scoped CSS: Vue calls this for every element inside a component whose
    // SFC defines <style scoped> (id comes from __sfc__.__scopeId)
    setScopeId: (el, scopeId) => {
      if (typeof scopeId === "string" && scopeId) styleEngine.addScope(el.id, scopeId);
    }
  };
  function makeHandle(id) {
    return {
      id,
      tag: "view",
      appendChild: () => {
        throw new Error("handle is read-only");
      },
      removeChild: () => {
        throw new Error("handle is read-only");
      },
      setText: () => {
        throw new Error("handle is read-only");
      },
      setProps: () => {
        throw new Error("handle is read-only");
      }
    };
  }
  function camelize2(key) {
    return key.replace(/-(\w)/g, (_, c) => c.toUpperCase());
  }
  var HTML_EVENT_ALIASES = {
    onClick: "onTap",
    onInput: "onTextChanged",
    onChange: "onValueChanged",
    onReset: "onFormReset"
  };
  function aliasEvent(tag, prop) {
    var _a4;
    if (prop === "onSubmit") return tag === "form" ? "onFormSubmit" : prop;
    if (prop === "onChange" && tag === "swiper") return "onPageChanged";
    return (_a4 = HTML_EVENT_ALIASES[prop]) != null ? _a4 : prop;
  }
  function asDomEvent(el, payload) {
    if (payload !== void 0 && typeof payload === "object") return payload;
    if (typeof payload === "string" && textValues.has(el.id)) textValues.set(el.id, payload);
    const event = {
      detail: payload,
      target: el,
      currentTarget: el,
      stopPropagation() {
      },
      stopImmediatePropagation() {
      },
      preventDefault() {
      }
    };
    let point;
    const at = () => point === void 0 ? point = lastPointer() : point;
    for (const [key, axis] of [["clientX", "x"], ["clientY", "y"], ["pageX", "x"], ["pageY", "y"]]) {
      Object.defineProperty(event, key, { enumerable: true, get: () => {
        var _a4, _b3;
        return (_b3 = (_a4 = at()) == null ? void 0 : _a4[axis]) != null ? _b3 : 0;
      } });
    }
    return event;
  }
  var OPTION_MODIFIER = /(?:Once|Passive|Capture)$/;
  var onceFired = /* @__PURE__ */ new Set();
  function parseEventName(prop) {
    let name = prop;
    let once = false;
    let m;
    while (m = name.match(OPTION_MODIFIER)) {
      if (m[0] === "Once") once = true;
      name = name.slice(0, name.length - m[0].length);
    }
    return { name, once };
  }
  var TEXT_CONTROL_TAGS = /* @__PURE__ */ new Set(["input", "textarea"]);
  var textValues = /* @__PURE__ */ new Map();
  function installTextControlValue(el) {
    textValues.set(el.id, "");
    Object.defineProperty(el, "value", {
      configurable: true,
      get: () => {
        var _a4;
        return (_a4 = textValues.get(el.id)) != null ? _a4 : "";
      },
      set: (v) => {
        const next = v == null ? "" : String(v);
        if (next === textValues.get(el.id)) return;
        textValues.set(el.id, next);
        setProps(el, { value: next });
      }
    });
    el.setSelectionRange = () => {
    };
  }
  var warnedInnerHtml = false;
  function htmlToText(html) {
    if (!/[<&]/.test(html)) return html;
    const text = html.replace(/<br\s*\/?>/gi, "\n");
    if (!warnedInnerHtml && /<[a-z!/]/i.test(text)) {
      warnedInnerHtml = true;
      console.warn("[fjs] innerHTML markup is shown as plain text on the app side (tags dropped)");
    }
    return text.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "\xA0").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  }
  var patchProp = (el, key, prevValue, nextValue) => {
    const prop = camelize2(key);
    if (prop === "class") {
      const vtc = transitionClassesOf(el);
      styleEngine.setClasses(el.id, vtc.length ? `${nextValue != null ? nextValue : ""} ${vtc.join(" ")}` : nextValue);
      return;
    }
    if (prop === "href" || prop === "srcset") {
      return;
    }
    if (prop === "textContent" || prop === "innerText" || prop === "innerHTML") {
      const raw = nextValue == null ? "" : String(nextValue);
      setText(el, prop === "innerHTML" ? htmlToText(raw) : raw);
      return;
    }
    if (prop === "id") {
      setProps(el, { id: nextValue == null ? null : String(nextValue) });
      return;
    }
    if (prop === "value" && textValues.has(el.id)) {
      textValues.set(el.id, nextValue == null ? "" : String(nextValue));
    }
    if (prop === "src" || prop === "value" || prop === "placeholder") {
      setProps(el, { [prop]: nextValue });
      return;
    }
    if (prop.startsWith("on")) {
      const { name, once } = parseEventName(prop);
      const native = aliasEvent(el.tag, name);
      if (nextValue == null) {
        onceFired.delete(`${el.id}:${native}`);
        setProps(el, { [native]: null });
      } else {
        const handlers = Array.isArray(nextValue) ? nextValue : [nextValue];
        const onceKey = `${el.id}:${native}`;
        setProps(el, {
          [native]: (payload) => {
            if (once) {
              if (onceFired.has(onceKey)) return;
              onceFired.add(onceKey);
            }
            const event = asDomEvent(el, payload);
            for (const h2 of handlers) h2(event);
          }
        });
      }
      return;
    }
    if (prop === "disabled") {
      styleEngine.setDisabled(el.id, nextValue != null && nextValue !== false);
    }
    if (prop === "style") {
      styleEngine.patchInlineStyle(el.id, prevValue, nextValue);
      return;
    }
    setProps(el, { [prop]: nextValue });
  };
  var { createApp: rendererCreateApp, render } = (0, import_runtime_core.createRenderer)({
    ...nodeOps,
    patchProp
  });
  function createApp(...args) {
    return rendererCreateApp(...args);
  }
  function flutterRoot(tag = "view") {
    const root = createRoot(tag);
    childrenOf.set(root.id, []);
    parentOf.set(root.id, null);
    pageRoots.set(root.id, root);
    devtoolsStructuralVersion.value++;
    return root;
  }
  devtoolsSlots.provider = {
    roots: () => [...pageRoots.keys()],
    // page roots live in pageRoots, not elementsById (createRoot is an
    // element-layer call; the renderer's own registry starts at its children)
    exists: (id) => elementsById.has(id) || pageRoots.has(id),
    tag: (id) => {
      var _a4, _b3, _c, _d;
      return (_d = (_c = (_a4 = elementsById.get(id)) == null ? void 0 : _a4.tag) != null ? _c : (_b3 = pageRoots.get(id)) == null ? void 0 : _b3.tag) != null ? _d : "";
    },
    childIds: (id) => {
      var _a4;
      return (_a4 = childrenOf.get(id)) != null ? _a4 : [];
    },
    classesOf: (id) => styleEngine.classesOf(id),
    inlineStyle: (id) => styleEngine.inlineRecord(id),
    computedStyle: (id) => styleEngine.computedOf(id),
    matchedRules: (id) => styleEngine.matchedRulesOf(id)
  };

  // packages/fjs-runtime/src/net/base64.ts
  var CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function base64Encode(bytes) {
    const parts = [];
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      out += CHARS[b0 >> 2];
      out += CHARS[(b0 & 3) << 4 | (b1 != null ? b1 : 0) >> 4];
      out += i + 1 < bytes.length ? CHARS[((b1 != null ? b1 : 0) & 15) << 2 | (b2 != null ? b2 : 0) >> 6] : "=";
      out += i + 2 < bytes.length ? CHARS[(b2 != null ? b2 : 0) & 63] : "=";
      if (out.length >= 8192) {
        parts.push(out);
        out = "";
      }
    }
    parts.push(out);
    return parts.join("");
  }

  // packages/fjs-runtime/src/devtools.ts
  var propsOf = /* @__PURE__ */ new Map();
  var textOf = /* @__PURE__ */ new Map();
  function recordProps(id, clean) {
    const prev = propsOf.get(id);
    propsOf.set(id, prev ? { ...prev, ...clean } : { ...clean });
  }
  function recordText(id, text) {
    textOf.set(id, text);
  }
  function cssText(style) {
    if (!style) return "";
    return Object.entries(style).map(([k, v]) => `${k}: ${String(v)}`).join("; ");
  }
  function buildNode(id, visited) {
    const provider = devtoolsSlots.provider;
    if (!provider || !provider.exists(id)) return null;
    visited.add(id);
    const attrs = {};
    const classes = provider.classesOf(id);
    if (classes.length) attrs.class = classes.join(" ");
    const inline = provider.inlineStyle(id);
    const styleText = cssText(inline);
    if (styleText) attrs.style = styleText;
    const props = propsOf.get(id);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === "style" || attrs[k] !== void 0) continue;
        attrs[k] = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
      }
    }
    const text = textOf.get(id);
    return {
      id,
      tag: provider.tag(id),
      attrs,
      text: text === void 0 ? void 0 : String(text),
      children: provider.childIds(id).map((cid) => buildNode(cid, visited)).filter((n) => n !== null)
    };
  }
  var NET_BODY_CAP = 512 * 1024;
  var NET_ROW_KEEP = 100;
  var netRows = /* @__PURE__ */ new Map();
  var netActive = false;
  function netRequest(row) {
    if (!netActive) return;
    netRows.set(row.id, {
      id: row.id,
      state: "pending",
      request: {
        url: row.url,
        method: row.method,
        headers: row.headers,
        bodyBase64: row.bodyBase64
      }
    });
  }
  var handleToRow = /* @__PURE__ */ new Map();
  function netResponse(row) {
    if (!netActive) return;
    const existing = netRows.get(row.id);
    if (!existing) return;
    let body;
    if (row.bodyBase64) {
      const size = Math.floor(row.bodyBase64.length * 3 / 4);
      body = size <= NET_BODY_CAP ? { base64: row.bodyBase64, size, truncated: false } : { size, truncated: true };
    } else if (row.handle != null) {
      handleToRow.set(row.handle, row.id);
    }
    netRows.set(row.id, {
      ...existing,
      state: "done",
      response: {
        url: row.url,
        status: row.status,
        statusText: row.statusText,
        headers: row.headers
      },
      body
    });
  }
  function netBodyMaterialized(handle, bytes) {
    const rowId = handleToRow.get(handle);
    if (rowId === void 0) return;
    const row = netRows.get(rowId);
    if (!row) return;
    const capped = bytes.length <= NET_BODY_CAP ? bytes : bytes.slice(0, NET_BODY_CAP);
    row.body = {
      base64: base64Encode(capped),
      size: bytes.length,
      truncated: bytes.length > NET_BODY_CAP
    };
  }
  function sweep(visited) {
    for (const id of propsOf.keys()) if (!visited.has(id)) propsOf.delete(id);
    for (const id of textOf.keys()) if (!visited.has(id)) textOf.delete(id);
  }
  function cmd(method, paramsJson) {
    var _a4;
    const params = paramsJson ? JSON.parse(paramsJson) : {};
    if (method === "DOM.getDocument") return docCmd();
    if (method === "CSS.getComputedStyleForNode" || method === "CSS.getMatchedStylesForNode") {
      return styleCmd(Number(params.id));
    }
    if (method === "Dom.version") return versionCmd();
    if (method === "Dom.structuralVersion") return structuralVersionCmd();
    if (method === "DOM.requestChildNodes") return requestChildNodesCmd(Number(params.id));
    if (method === "DOM.getFlattenedInnerHTML") return flattenedHtmlCmd(Number(params.id));
    if (method === "DOM.querySelector") {
      return querySelectorCmd(
        params.id === void 0 || params.id === null ? null : Number(params.id),
        String((_a4 = params.selector) != null ? _a4 : "")
      );
    }
    if (method === "Network.drain") return drainCmd();
    if (method === "Network.getResponseBody") return bodyCmd(Number(params.id));
    throw new Error(`__fjsDevtools: unknown cmd ${method}`);
  }
  function docCmd() {
    const provider = devtoolsSlots.provider;
    if (!provider) return { roots: [], live: false };
    const visited = /* @__PURE__ */ new Set();
    const roots = provider.roots().map((id) => buildNode(id, visited)).filter((n) => n !== null);
    sweep(visited);
    return { roots, live: true };
  }
  function styleCmd(id) {
    var _a4, _b3, _c, _d;
    const provider = devtoolsSlots.provider;
    return {
      computed: (_a4 = provider == null ? void 0 : provider.computedStyle(id)) != null ? _a4 : {},
      inline: (_b3 = provider == null ? void 0 : provider.inlineStyle(id)) != null ? _b3 : {},
      classes: provider ? provider.classesOf(id) : [],
      // spec 092: false means the id is gone from the live tree (DevTools is
      // reading a stale snapshot) — the relay answers empty AND pushes
      // DOM.documentUpdated so the panel re-pulls instead of staying dead
      exists: !!provider && provider.exists(id),
      // the Styles panel's matched-rules list (selector texts, matched
      // indices, per-rule declarations), in cascade order
      matched: (_d = (_c = provider == null ? void 0 : provider.matchedRules) == null ? void 0 : _c.call(provider, id)) != null ? _d : []
    };
  }
  function versionCmd() {
    return { version: devtoolsTreeVersion.value };
  }
  function structuralVersionCmd() {
    return { version: devtoolsStructuralVersion.value };
  }
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function serializeHtml(node) {
    const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join("");
    const open = `<${node.tag}${attrs}>`;
    const close = `</${node.tag}>`;
    const inner = (node.text === void 0 ? "" : escapeHtml(node.text)) + node.children.map(serializeHtml).join("");
    return inner ? open + inner + close : open;
  }
  function requestChildNodesCmd(id) {
    const provider = devtoolsSlots.provider;
    if (!provider || !provider.exists(id)) return { id, children: [] };
    const visited = /* @__PURE__ */ new Set();
    const children = provider.childIds(id).map((cid) => buildNode(cid, visited)).filter((n) => n !== null);
    return { id, children };
  }
  function flattenedHtmlCmd(id) {
    const provider = devtoolsSlots.provider;
    if (!provider || !provider.exists(id)) return { html: "" };
    const node = buildNode(id, /* @__PURE__ */ new Set());
    return { html: node ? serializeHtml(node) : "" };
  }
  function querySelectorCmd(scopedId, selector) {
    const provider = devtoolsSlots.provider;
    if (!provider) return { id: 0 };
    const parseStep = (raw) => {
      var _a4;
      const step = { classes: [], attrs: [] };
      const re = /([a-zA-Z][\w-]*|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=([^\]]+))?\])|:([\w-]+)(\([^)]*\))?/g;
      let matchedAny = false;
      let consumed = 0;
      let m;
      while ((m = re.exec(raw)) !== null) {
        if (m.index !== consumed) return null;
        consumed = m.index + m[0].length;
        if (m[1]) {
          matchedAny = true;
          if (m[1][0] === "#") step.id = m[2];
          else if (m[1][0] === ".") step.classes.push(m[3]);
          else if (m[1][0] === "[") step.attrs.push([m[4], (_a4 = m[5]) != null ? _a4 : ""]);
          else step.tag = m[1];
        }
      }
      if (consumed !== raw.length) return null;
      return matchedAny ? step : null;
    };
    const matchesStep = (id, step) => {
      var _a4, _b3, _c;
      if (step.tag && provider.tag(id) !== step.tag) return false;
      if (step.id && ((_a4 = propsOf.get(id)) == null ? void 0 : _a4["id"]) !== step.id) return false;
      if (step.classes.length) {
        const classes = provider.classesOf(id);
        for (const cls of step.classes) if (!classes.includes(cls)) return false;
      }
      for (const [name, value] of step.attrs) {
        const props = propsOf.get(id);
        const actual = (_c = (_b3 = provider.inlineStyle(id)) == null ? void 0 : _b3[name]) != null ? _c : props == null ? void 0 : props[name];
        if (actual === void 0) return false;
        if (value !== "" && String(actual) !== value) return false;
      }
      return true;
    };
    const parts = selector.trim().split(/\s+/).map(parseStep);
    if (!parts.length || parts.some((p) => p === null)) return { id: 0 };
    const steps = parts;
    const last = steps.length - 1;
    const walk = (id, depth) => {
      if (!provider.exists(id)) return 0;
      const nowMatched = matchesStep(id, steps[depth]) ? depth + 1 : depth;
      if (nowMatched > last) return id;
      for (const cid of provider.childIds(id)) {
        const hit = walk(cid, nowMatched) || (nowMatched > depth ? walk(cid, depth) : 0);
        if (hit) return hit;
      }
      return 0;
    };
    const roots = scopedId === null ? provider.roots() : [scopedId];
    for (const root of roots) {
      const hit = walk(root, 0);
      if (hit) return { id: hit };
    }
    return { id: 0 };
  }
  function drainCmd() {
    netActive = true;
    const rows = [];
    for (const row of netRows.values()) rows.push(row);
    while (netRows.size > NET_ROW_KEEP) {
      netRows.delete(netRows.keys().next().value);
    }
    return { rows };
  }
  function bodyCmd(id) {
    var _a4;
    const row = netRows.get(id);
    return (_a4 = row == null ? void 0 : row.body) != null ? _a4 : { size: -1, truncated: false };
  }
  function devtoolsBoot() {
    devtoolsSlots.recordProps = recordProps;
    devtoolsSlots.recordText = recordText;
    devtoolsSlots.netRequest = netRequest;
    devtoolsSlots.netResponse = netResponse;
    devtoolsSlots.netBodyMaterialized = netBodyMaterialized;
    const g2 = globalThis;
    g2.__fjsDevtools = {
      version: "093-1",
      cmd: (method, paramsJson) => JSON.stringify(cmd(method, paramsJson))
    };
  }

  // specs/093-devtools-tree-lazy-and-live/e2e/app-entry.js
  setOpSink(() => {
  });
  devtoolsBoot();
  var Page0 = (0, import_runtime_core2.defineComponent)(
    () => () => (0, import_runtime_core2.h)("view", { id: "shell", class: "page inner" }, [
      (0, import_runtime_core2.h)("text", { class: "title" }, "page zero")
    ])
  );
  createApp(Page0).mount(flutterRoot("view"));
  globalThis.__addPage = () => {
    const r = flutterRoot("view");
    const Page1 = (0, import_runtime_core2.defineComponent)(
      () => () => (0, import_runtime_core2.h)("view", { class: "page1" }, [(0, import_runtime_core2.h)("text", null, "page one")])
    );
    createApp(Page1).mount(r);
    return true;
  };
  globalThis.__probe = () => typeof globalThis.__fjsDevtools;
})();
/*! Bundled license information:

@vue/shared/dist/shared.cjs.js:
  (**
  * @vue/shared v3.5.42
  * (c) 2018-present Yuxi (Evan) You and Vue contributors
  * @license MIT
  **)

@vue/reactivity/dist/reactivity.cjs.js:
  (**
  * @vue/reactivity v3.5.42
  * (c) 2018-present Yuxi (Evan) You and Vue contributors
  * @license MIT
  **)

@vue/runtime-core/dist/runtime-core.cjs.js:
  (**
  * @vue/runtime-core v3.5.42
  * (c) 2018-present Yuxi (Evan) You and Vue contributors
  * @license MIT
  **)
*/
