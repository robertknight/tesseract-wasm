(function (factory) {
    typeof define === 'function' && define.amd ? define(factory) :
    factory();
})((function () { 'use strict';

    /**
     * Copyright 2019 Google Inc. All Rights Reserved.
     * Licensed under the Apache License, Version 2.0 (the "License");
     * you may not use this file except in compliance with the License.
     * You may obtain a copy of the License at
     *     http://www.apache.org/licenses/LICENSE-2.0
     * Unless required by applicable law or agreed to in writing, software
     * distributed under the License is distributed on an "AS IS" BASIS,
     * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
     * See the License for the specific language governing permissions and
     * limitations under the License.
     */
    const proxyMarker = Symbol("Comlink.proxy");
    const createEndpoint = Symbol("Comlink.endpoint");
    const releaseProxy = Symbol("Comlink.releaseProxy");
    const throwMarker = Symbol("Comlink.thrown");
    const isObject = (val) => (typeof val === "object" && val !== null) || typeof val === "function";
    /**
     * Internal transfer handle to handle objects marked to proxy.
     */
    const proxyTransferHandler = {
        canHandle: (val) => isObject(val) && val[proxyMarker],
        serialize(obj) {
            const { port1, port2 } = new MessageChannel();
            expose(obj, port1);
            return [port2, [port2]];
        },
        deserialize(port) {
            port.start();
            return wrap(port);
        },
    };
    /**
     * Internal transfer handler to handle thrown exceptions.
     */
    const throwTransferHandler = {
        canHandle: (value) => isObject(value) && throwMarker in value,
        serialize({ value }) {
            let serialized;
            if (value instanceof Error) {
                serialized = {
                    isError: true,
                    value: {
                        message: value.message,
                        name: value.name,
                        stack: value.stack,
                    },
                };
            }
            else {
                serialized = { isError: false, value };
            }
            return [serialized, []];
        },
        deserialize(serialized) {
            if (serialized.isError) {
                throw Object.assign(new Error(serialized.value.message), serialized.value);
            }
            throw serialized.value;
        },
    };
    /**
     * Allows customizing the serialization of certain values.
     */
    const transferHandlers = new Map([
        ["proxy", proxyTransferHandler],
        ["throw", throwTransferHandler],
    ]);
    function expose(obj, ep = self) {
        ep.addEventListener("message", function callback(ev) {
            if (!ev || !ev.data) {
                return;
            }
            const { id, type, path } = Object.assign({ path: [] }, ev.data);
            const argumentList = (ev.data.argumentList || []).map(fromWireValue);
            let returnValue;
            try {
                const parent = path.slice(0, -1).reduce((obj, prop) => obj[prop], obj);
                const rawValue = path.reduce((obj, prop) => obj[prop], obj);
                switch (type) {
                    case "GET" /* GET */:
                        {
                            returnValue = rawValue;
                        }
                        break;
                    case "SET" /* SET */:
                        {
                            parent[path.slice(-1)[0]] = fromWireValue(ev.data.value);
                            returnValue = true;
                        }
                        break;
                    case "APPLY" /* APPLY */:
                        {
                            returnValue = rawValue.apply(parent, argumentList);
                        }
                        break;
                    case "CONSTRUCT" /* CONSTRUCT */:
                        {
                            const value = new rawValue(...argumentList);
                            returnValue = proxy(value);
                        }
                        break;
                    case "ENDPOINT" /* ENDPOINT */:
                        {
                            const { port1, port2 } = new MessageChannel();
                            expose(obj, port2);
                            returnValue = transfer(port1, [port1]);
                        }
                        break;
                    case "RELEASE" /* RELEASE */:
                        {
                            returnValue = undefined;
                        }
                        break;
                    default:
                        return;
                }
            }
            catch (value) {
                returnValue = { value, [throwMarker]: 0 };
            }
            Promise.resolve(returnValue)
                .catch((value) => {
                return { value, [throwMarker]: 0 };
            })
                .then((returnValue) => {
                const [wireValue, transferables] = toWireValue(returnValue);
                ep.postMessage(Object.assign(Object.assign({}, wireValue), { id }), transferables);
                if (type === "RELEASE" /* RELEASE */) {
                    // detach and deactive after sending release response above.
                    ep.removeEventListener("message", callback);
                    closeEndPoint(ep);
                }
            });
        });
        if (ep.start) {
            ep.start();
        }
    }
    function isMessagePort(endpoint) {
        return endpoint.constructor.name === "MessagePort";
    }
    function closeEndPoint(endpoint) {
        if (isMessagePort(endpoint))
            endpoint.close();
    }
    function wrap(ep, target) {
        return createProxy(ep, [], target);
    }
    function throwIfProxyReleased(isReleased) {
        if (isReleased) {
            throw new Error("Proxy has been released and is not useable");
        }
    }
    function createProxy(ep, path = [], target = function () { }) {
        let isProxyReleased = false;
        const proxy = new Proxy(target, {
            get(_target, prop) {
                throwIfProxyReleased(isProxyReleased);
                if (prop === releaseProxy) {
                    return () => {
                        return requestResponseMessage(ep, {
                            type: "RELEASE" /* RELEASE */,
                            path: path.map((p) => p.toString()),
                        }).then(() => {
                            closeEndPoint(ep);
                            isProxyReleased = true;
                        });
                    };
                }
                if (prop === "then") {
                    if (path.length === 0) {
                        return { then: () => proxy };
                    }
                    const r = requestResponseMessage(ep, {
                        type: "GET" /* GET */,
                        path: path.map((p) => p.toString()),
                    }).then(fromWireValue);
                    return r.then.bind(r);
                }
                return createProxy(ep, [...path, prop]);
            },
            set(_target, prop, rawValue) {
                throwIfProxyReleased(isProxyReleased);
                // FIXME: ES6 Proxy Handler `set` methods are supposed to return a
                // boolean. To show good will, we return true asynchronously ¯\_(ツ)_/¯
                const [value, transferables] = toWireValue(rawValue);
                return requestResponseMessage(ep, {
                    type: "SET" /* SET */,
                    path: [...path, prop].map((p) => p.toString()),
                    value,
                }, transferables).then(fromWireValue);
            },
            apply(_target, _thisArg, rawArgumentList) {
                throwIfProxyReleased(isProxyReleased);
                const last = path[path.length - 1];
                if (last === createEndpoint) {
                    return requestResponseMessage(ep, {
                        type: "ENDPOINT" /* ENDPOINT */,
                    }).then(fromWireValue);
                }
                // We just pretend that `bind()` didn’t happen.
                if (last === "bind") {
                    return createProxy(ep, path.slice(0, -1));
                }
                const [argumentList, transferables] = processArguments(rawArgumentList);
                return requestResponseMessage(ep, {
                    type: "APPLY" /* APPLY */,
                    path: path.map((p) => p.toString()),
                    argumentList,
                }, transferables).then(fromWireValue);
            },
            construct(_target, rawArgumentList) {
                throwIfProxyReleased(isProxyReleased);
                const [argumentList, transferables] = processArguments(rawArgumentList);
                return requestResponseMessage(ep, {
                    type: "CONSTRUCT" /* CONSTRUCT */,
                    path: path.map((p) => p.toString()),
                    argumentList,
                }, transferables).then(fromWireValue);
            },
        });
        return proxy;
    }
    function myFlat(arr) {
        return Array.prototype.concat.apply([], arr);
    }
    function processArguments(argumentList) {
        const processed = argumentList.map(toWireValue);
        return [processed.map((v) => v[0]), myFlat(processed.map((v) => v[1]))];
    }
    const transferCache = new WeakMap();
    function transfer(obj, transfers) {
        transferCache.set(obj, transfers);
        return obj;
    }
    function proxy(obj) {
        return Object.assign(obj, { [proxyMarker]: true });
    }
    function toWireValue(value) {
        for (const [name, handler] of transferHandlers) {
            if (handler.canHandle(value)) {
                const [serializedValue, transferables] = handler.serialize(value);
                return [
                    {
                        type: "HANDLER" /* HANDLER */,
                        name,
                        value: serializedValue,
                    },
                    transferables,
                ];
            }
        }
        return [
            {
                type: "RAW" /* RAW */,
                value,
            },
            transferCache.get(value) || [],
        ];
    }
    function fromWireValue(value) {
        switch (value.type) {
            case "HANDLER" /* HANDLER */:
                return transferHandlers.get(value.name).deserialize(value.value);
            case "RAW" /* RAW */:
                return value.value;
        }
    }
    function requestResponseMessage(ep, msg, transfers) {
        return new Promise((resolve) => {
            const id = generateUUID();
            ep.addEventListener("message", function l(ev) {
                if (!ev.data || !ev.data.id || ev.data.id !== id) {
                    return;
                }
                ep.removeEventListener("message", l);
                resolve(ev.data);
            });
            if (ep.start) {
                ep.start();
            }
            ep.postMessage(Object.assign({ id }, msg), transfers);
        });
    }
    function generateUUID() {
        return new Array(4)
            .fill(0)
            .map(() => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16))
            .join("-");
    }

    var Module = (() => {
      var _scriptDir = (typeof document === 'undefined' && typeof location === 'undefined' ? new (require('u' + 'rl').URL)('file:' + __filename).href : typeof document === 'undefined' ? location.href : (document.currentScript && document.currentScript.src || new URL('tesseract-worker.js', document.baseURI).href));
      
      return (
    function(Module) {
      Module = Module || {};

    var Module=typeof Module!="undefined"?Module:{};var readyPromiseResolve,readyPromiseReject;Module["ready"]=new Promise(function(resolve,reject){readyPromiseResolve=resolve;readyPromiseReject=reject;});var moduleOverrides=Object.assign({},Module);var thisProgram="./this.program";var ENVIRONMENT_IS_WEB=true;var scriptDirectory="";function locateFile(path){if(Module["locateFile"]){return Module["locateFile"](path,scriptDirectory)}return scriptDirectory+path}var readBinary;{if(typeof document!="undefined"&&document.currentScript){scriptDirectory=document.currentScript.src;}if(_scriptDir){scriptDirectory=_scriptDir;}if(scriptDirectory.indexOf("blob:")!==0){scriptDirectory=scriptDirectory.substr(0,scriptDirectory.replace(/[?#].*/,"").lastIndexOf("/")+1);}else {scriptDirectory="";}}var out=Module["print"]||console.log.bind(console);var err=Module["printErr"]||console.warn.bind(console);Object.assign(Module,moduleOverrides);moduleOverrides=null;if(Module["arguments"]);if(Module["thisProgram"])thisProgram=Module["thisProgram"];if(Module["quit"]);var POINTER_SIZE=4;var wasmBinary;if(Module["wasmBinary"])wasmBinary=Module["wasmBinary"];Module["noExitRuntime"]||true;if(typeof WebAssembly!="object"){abort("no native wasm support detected");}var wasmMemory;var ABORT=false;function assert(condition,text){if(!condition){abort(text);}}var UTF8Decoder=typeof TextDecoder!="undefined"?new TextDecoder("utf8"):undefined;function UTF8ArrayToString(heapOrArray,idx,maxBytesToRead){var endIdx=idx+maxBytesToRead;var endPtr=idx;while(heapOrArray[endPtr]&&!(endPtr>=endIdx))++endPtr;if(endPtr-idx>16&&heapOrArray.buffer&&UTF8Decoder){return UTF8Decoder.decode(heapOrArray.subarray(idx,endPtr))}else {var str="";while(idx<endPtr){var u0=heapOrArray[idx++];if(!(u0&128)){str+=String.fromCharCode(u0);continue}var u1=heapOrArray[idx++]&63;if((u0&224)==192){str+=String.fromCharCode((u0&31)<<6|u1);continue}var u2=heapOrArray[idx++]&63;if((u0&240)==224){u0=(u0&15)<<12|u1<<6|u2;}else {u0=(u0&7)<<18|u1<<12|u2<<6|heapOrArray[idx++]&63;}if(u0<65536){str+=String.fromCharCode(u0);}else {var ch=u0-65536;str+=String.fromCharCode(55296|ch>>10,56320|ch&1023);}}}return str}function UTF8ToString(ptr,maxBytesToRead){return ptr?UTF8ArrayToString(HEAPU8,ptr,maxBytesToRead):""}function stringToUTF8Array(str,heap,outIdx,maxBytesToWrite){if(!(maxBytesToWrite>0))return 0;var startIdx=outIdx;var endIdx=outIdx+maxBytesToWrite-1;for(var i=0;i<str.length;++i){var u=str.charCodeAt(i);if(u>=55296&&u<=57343){var u1=str.charCodeAt(++i);u=65536+((u&1023)<<10)|u1&1023;}if(u<=127){if(outIdx>=endIdx)break;heap[outIdx++]=u;}else if(u<=2047){if(outIdx+1>=endIdx)break;heap[outIdx++]=192|u>>6;heap[outIdx++]=128|u&63;}else if(u<=65535){if(outIdx+2>=endIdx)break;heap[outIdx++]=224|u>>12;heap[outIdx++]=128|u>>6&63;heap[outIdx++]=128|u&63;}else {if(outIdx+3>=endIdx)break;heap[outIdx++]=240|u>>18;heap[outIdx++]=128|u>>12&63;heap[outIdx++]=128|u>>6&63;heap[outIdx++]=128|u&63;}}heap[outIdx]=0;return outIdx-startIdx}function stringToUTF8(str,outPtr,maxBytesToWrite){return stringToUTF8Array(str,HEAPU8,outPtr,maxBytesToWrite)}function lengthBytesUTF8(str){var len=0;for(var i=0;i<str.length;++i){var u=str.charCodeAt(i);if(u>=55296&&u<=57343)u=65536+((u&1023)<<10)|str.charCodeAt(++i)&1023;if(u<=127)++len;else if(u<=2047)len+=2;else if(u<=65535)len+=3;else len+=4;}return len}var buffer,HEAP8,HEAPU8,HEAP16,HEAPU16,HEAP32,HEAPU32,HEAPF32,HEAPF64;function updateGlobalBufferAndViews(buf){buffer=buf;Module["HEAP8"]=HEAP8=new Int8Array(buf);Module["HEAP16"]=HEAP16=new Int16Array(buf);Module["HEAP32"]=HEAP32=new Int32Array(buf);Module["HEAPU8"]=HEAPU8=new Uint8Array(buf);Module["HEAPU16"]=HEAPU16=new Uint16Array(buf);Module["HEAPU32"]=HEAPU32=new Uint32Array(buf);Module["HEAPF32"]=HEAPF32=new Float32Array(buf);Module["HEAPF64"]=HEAPF64=new Float64Array(buf);}Module["INITIAL_MEMORY"]||16777216;var wasmTable;var __ATPRERUN__=[];var __ATINIT__=[];var __ATPOSTRUN__=[];function preRun(){if(Module["preRun"]){if(typeof Module["preRun"]=="function")Module["preRun"]=[Module["preRun"]];while(Module["preRun"].length){addOnPreRun(Module["preRun"].shift());}}callRuntimeCallbacks(__ATPRERUN__);}function initRuntime(){callRuntimeCallbacks(__ATINIT__);}function postRun(){if(Module["postRun"]){if(typeof Module["postRun"]=="function")Module["postRun"]=[Module["postRun"]];while(Module["postRun"].length){addOnPostRun(Module["postRun"].shift());}}callRuntimeCallbacks(__ATPOSTRUN__);}function addOnPreRun(cb){__ATPRERUN__.unshift(cb);}function addOnInit(cb){__ATINIT__.unshift(cb);}function addOnPostRun(cb){__ATPOSTRUN__.unshift(cb);}var runDependencies=0;var dependenciesFulfilled=null;function addRunDependency(id){runDependencies++;if(Module["monitorRunDependencies"]){Module["monitorRunDependencies"](runDependencies);}}function removeRunDependency(id){runDependencies--;if(Module["monitorRunDependencies"]){Module["monitorRunDependencies"](runDependencies);}if(runDependencies==0){if(dependenciesFulfilled){var callback=dependenciesFulfilled;dependenciesFulfilled=null;callback();}}}function abort(what){{if(Module["onAbort"]){Module["onAbort"](what);}}what="Aborted("+what+")";err(what);ABORT=true;what+=". Build with -sASSERTIONS for more info.";var e=new WebAssembly.RuntimeError(what);readyPromiseReject(e);throw e}var dataURIPrefix="data:application/octet-stream;base64,";function isDataURI(filename){return filename.startsWith(dataURIPrefix)}var wasmBinaryFile;if(Module["locateFile"]){wasmBinaryFile="tesseract-core.wasm";if(!isDataURI(wasmBinaryFile)){wasmBinaryFile=locateFile(wasmBinaryFile);}}else {wasmBinaryFile=new URL("tesseract-core.wasm",(typeof document === 'undefined' && typeof location === 'undefined' ? new (require('u' + 'rl').URL)('file:' + __filename).href : typeof document === 'undefined' ? location.href : (document.currentScript && document.currentScript.src || new URL('tesseract-worker.js', document.baseURI).href))).toString();}function getBinary(file){try{if(file==wasmBinaryFile&&wasmBinary){return new Uint8Array(wasmBinary)}if(readBinary);else {throw "both async and sync fetching of the wasm failed"}}catch(err){abort(err);}}function getBinaryPromise(){if(!wasmBinary&&(ENVIRONMENT_IS_WEB)){if(typeof fetch=="function"){return fetch(wasmBinaryFile,{credentials:"same-origin"}).then(function(response){if(!response["ok"]){throw "failed to load wasm binary file at '"+wasmBinaryFile+"'"}return response["arrayBuffer"]()}).catch(function(){return getBinary(wasmBinaryFile)})}}return Promise.resolve().then(function(){return getBinary(wasmBinaryFile)})}function createWasm(){var info={"a":asmLibraryArg};function receiveInstance(instance,module){var exports=instance.exports;Module["asm"]=exports;wasmMemory=Module["asm"]["W"];updateGlobalBufferAndViews(wasmMemory.buffer);wasmTable=Module["asm"]["Z"];addOnInit(Module["asm"]["X"]);removeRunDependency();}addRunDependency();function receiveInstantiationResult(result){receiveInstance(result["instance"]);}function instantiateArrayBuffer(receiver){return getBinaryPromise().then(function(binary){return WebAssembly.instantiate(binary,info)}).then(function(instance){return instance}).then(receiver,function(reason){err("failed to asynchronously prepare wasm: "+reason);abort(reason);})}function instantiateAsync(){if(!wasmBinary&&typeof WebAssembly.instantiateStreaming=="function"&&!isDataURI(wasmBinaryFile)&&typeof fetch=="function"){return fetch(wasmBinaryFile,{credentials:"same-origin"}).then(function(response){var result=WebAssembly.instantiateStreaming(response,info);return result.then(receiveInstantiationResult,function(reason){err("wasm streaming compile failed: "+reason);err("falling back to ArrayBuffer instantiation");return instantiateArrayBuffer(receiveInstantiationResult)})})}else {return instantiateArrayBuffer(receiveInstantiationResult)}}if(Module["instantiateWasm"]){try{var exports=Module["instantiateWasm"](info,receiveInstance);return exports}catch(e){err("Module.instantiateWasm callback failed with error: "+e);return false}}instantiateAsync().catch(readyPromiseReject);return {}}function callRuntimeCallbacks(callbacks){while(callbacks.length>0){callbacks.shift()(Module);}}function writeArrayToMemory(array,buffer){HEAP8.set(array,buffer);}function ___cxa_allocate_exception(size){return _malloc(size+24)+24}function ExceptionInfo(excPtr){this.excPtr=excPtr;this.ptr=excPtr-24;this.set_type=function(type){HEAPU32[this.ptr+4>>2]=type;};this.get_type=function(){return HEAPU32[this.ptr+4>>2]};this.set_destructor=function(destructor){HEAPU32[this.ptr+8>>2]=destructor;};this.get_destructor=function(){return HEAPU32[this.ptr+8>>2]};this.set_refcount=function(refcount){HEAP32[this.ptr>>2]=refcount;};this.set_caught=function(caught){caught=caught?1:0;HEAP8[this.ptr+12>>0]=caught;};this.get_caught=function(){return HEAP8[this.ptr+12>>0]!=0};this.set_rethrown=function(rethrown){rethrown=rethrown?1:0;HEAP8[this.ptr+13>>0]=rethrown;};this.get_rethrown=function(){return HEAP8[this.ptr+13>>0]!=0};this.init=function(type,destructor){this.set_adjusted_ptr(0);this.set_type(type);this.set_destructor(destructor);this.set_refcount(0);this.set_caught(false);this.set_rethrown(false);};this.add_ref=function(){var value=HEAP32[this.ptr>>2];HEAP32[this.ptr>>2]=value+1;};this.release_ref=function(){var prev=HEAP32[this.ptr>>2];HEAP32[this.ptr>>2]=prev-1;return prev===1};this.set_adjusted_ptr=function(adjustedPtr){HEAPU32[this.ptr+16>>2]=adjustedPtr;};this.get_adjusted_ptr=function(){return HEAPU32[this.ptr+16>>2]};this.get_exception_ptr=function(){var isPointer=___cxa_is_pointer_type(this.get_type());if(isPointer){return HEAPU32[this.excPtr>>2]}var adjusted=this.get_adjusted_ptr();if(adjusted!==0)return adjusted;return this.excPtr};}function ___cxa_throw(ptr,type,destructor){var info=new ExceptionInfo(ptr);info.init(type,destructor);throw ptr}function ___syscall_fcntl64(fd,cmd,varargs){return 0}function ___syscall_getcwd(buf,size){}function ___syscall_ioctl(fd,op,varargs){return 0}function ___syscall_openat(dirfd,path,flags,varargs){}function ___syscall_rmdir(path){}function ___syscall_unlinkat(dirfd,path,flags){}var structRegistrations={};function runDestructors(destructors){while(destructors.length){var ptr=destructors.pop();var del=destructors.pop();del(ptr);}}function simpleReadValueFromPointer(pointer){return this["fromWireType"](HEAP32[pointer>>2])}var awaitingDependencies={};var registeredTypes={};var typeDependencies={};var char_0=48;var char_9=57;function makeLegalFunctionName(name){if(undefined===name){return "_unknown"}name=name.replace(/[^a-zA-Z0-9_]/g,"$");var f=name.charCodeAt(0);if(f>=char_0&&f<=char_9){return "_"+name}return name}function createNamedFunction(name,body){name=makeLegalFunctionName(name);return new Function("body","return function "+name+"() {\n"+'    "use strict";'+"    return body.apply(this, arguments);\n"+"};\n")(body)}function extendError(baseErrorType,errorName){var errorClass=createNamedFunction(errorName,function(message){this.name=errorName;this.message=message;var stack=new Error(message).stack;if(stack!==undefined){this.stack=this.toString()+"\n"+stack.replace(/^Error(:[^\n]*)?\n/,"");}});errorClass.prototype=Object.create(baseErrorType.prototype);errorClass.prototype.constructor=errorClass;errorClass.prototype.toString=function(){if(this.message===undefined){return this.name}else {return this.name+": "+this.message}};return errorClass}var InternalError=undefined;function throwInternalError(message){throw new InternalError(message)}function whenDependentTypesAreResolved(myTypes,dependentTypes,getTypeConverters){myTypes.forEach(function(type){typeDependencies[type]=dependentTypes;});function onComplete(typeConverters){var myTypeConverters=getTypeConverters(typeConverters);if(myTypeConverters.length!==myTypes.length){throwInternalError("Mismatched type converter count");}for(var i=0;i<myTypes.length;++i){registerType(myTypes[i],myTypeConverters[i]);}}var typeConverters=new Array(dependentTypes.length);var unregisteredTypes=[];var registered=0;dependentTypes.forEach((dt,i)=>{if(registeredTypes.hasOwnProperty(dt)){typeConverters[i]=registeredTypes[dt];}else {unregisteredTypes.push(dt);if(!awaitingDependencies.hasOwnProperty(dt)){awaitingDependencies[dt]=[];}awaitingDependencies[dt].push(()=>{typeConverters[i]=registeredTypes[dt];++registered;if(registered===unregisteredTypes.length){onComplete(typeConverters);}});}});if(0===unregisteredTypes.length){onComplete(typeConverters);}}function __embind_finalize_value_object(structType){var reg=structRegistrations[structType];delete structRegistrations[structType];var rawConstructor=reg.rawConstructor;var rawDestructor=reg.rawDestructor;var fieldRecords=reg.fields;var fieldTypes=fieldRecords.map(field=>field.getterReturnType).concat(fieldRecords.map(field=>field.setterArgumentType));whenDependentTypesAreResolved([structType],fieldTypes,fieldTypes=>{var fields={};fieldRecords.forEach((field,i)=>{var fieldName=field.fieldName;var getterReturnType=fieldTypes[i];var getter=field.getter;var getterContext=field.getterContext;var setterArgumentType=fieldTypes[i+fieldRecords.length];var setter=field.setter;var setterContext=field.setterContext;fields[fieldName]={read:ptr=>{return getterReturnType["fromWireType"](getter(getterContext,ptr))},write:(ptr,o)=>{var destructors=[];setter(setterContext,ptr,setterArgumentType["toWireType"](destructors,o));runDestructors(destructors);}};});return [{name:reg.name,"fromWireType":function(ptr){var rv={};for(var i in fields){rv[i]=fields[i].read(ptr);}rawDestructor(ptr);return rv},"toWireType":function(destructors,o){for(var fieldName in fields){if(!(fieldName in o)){throw new TypeError('Missing field:  "'+fieldName+'"')}}var ptr=rawConstructor();for(fieldName in fields){fields[fieldName].write(ptr,o[fieldName]);}if(destructors!==null){destructors.push(rawDestructor,ptr);}return ptr},"argPackAdvance":8,"readValueFromPointer":simpleReadValueFromPointer,destructorFunction:rawDestructor}]});}function __embind_register_bigint(primitiveType,name,size,minRange,maxRange){}function getShiftFromSize(size){switch(size){case 1:return 0;case 2:return 1;case 4:return 2;case 8:return 3;default:throw new TypeError("Unknown type size: "+size)}}function embind_init_charCodes(){var codes=new Array(256);for(var i=0;i<256;++i){codes[i]=String.fromCharCode(i);}embind_charCodes=codes;}var embind_charCodes=undefined;function readLatin1String(ptr){var ret="";var c=ptr;while(HEAPU8[c]){ret+=embind_charCodes[HEAPU8[c++]];}return ret}var BindingError=undefined;function throwBindingError(message){throw new BindingError(message)}function registerType(rawType,registeredInstance,options={}){if(!("argPackAdvance"in registeredInstance)){throw new TypeError("registerType registeredInstance requires argPackAdvance")}var name=registeredInstance.name;if(!rawType){throwBindingError('type "'+name+'" must have a positive integer typeid pointer');}if(registeredTypes.hasOwnProperty(rawType)){if(options.ignoreDuplicateRegistrations){return}else {throwBindingError("Cannot register type '"+name+"' twice");}}registeredTypes[rawType]=registeredInstance;delete typeDependencies[rawType];if(awaitingDependencies.hasOwnProperty(rawType)){var callbacks=awaitingDependencies[rawType];delete awaitingDependencies[rawType];callbacks.forEach(cb=>cb());}}function __embind_register_bool(rawType,name,size,trueValue,falseValue){var shift=getShiftFromSize(size);name=readLatin1String(name);registerType(rawType,{name:name,"fromWireType":function(wt){return !!wt},"toWireType":function(destructors,o){return o?trueValue:falseValue},"argPackAdvance":8,"readValueFromPointer":function(pointer){var heap;if(size===1){heap=HEAP8;}else if(size===2){heap=HEAP16;}else if(size===4){heap=HEAP32;}else {throw new TypeError("Unknown boolean type size: "+name)}return this["fromWireType"](heap[pointer>>shift])},destructorFunction:null});}function ClassHandle_isAliasOf(other){if(!(this instanceof ClassHandle)){return false}if(!(other instanceof ClassHandle)){return false}var leftClass=this.$$.ptrType.registeredClass;var left=this.$$.ptr;var rightClass=other.$$.ptrType.registeredClass;var right=other.$$.ptr;while(leftClass.baseClass){left=leftClass.upcast(left);leftClass=leftClass.baseClass;}while(rightClass.baseClass){right=rightClass.upcast(right);rightClass=rightClass.baseClass;}return leftClass===rightClass&&left===right}function shallowCopyInternalPointer(o){return {count:o.count,deleteScheduled:o.deleteScheduled,preservePointerOnDelete:o.preservePointerOnDelete,ptr:o.ptr,ptrType:o.ptrType,smartPtr:o.smartPtr,smartPtrType:o.smartPtrType}}function throwInstanceAlreadyDeleted(obj){function getInstanceTypeName(handle){return handle.$$.ptrType.registeredClass.name}throwBindingError(getInstanceTypeName(obj)+" instance already deleted");}var finalizationRegistry=false;function detachFinalizer(handle){}function runDestructor($$){if($$.smartPtr){$$.smartPtrType.rawDestructor($$.smartPtr);}else {$$.ptrType.registeredClass.rawDestructor($$.ptr);}}function releaseClassHandle($$){$$.count.value-=1;var toDelete=0===$$.count.value;if(toDelete){runDestructor($$);}}function downcastPointer(ptr,ptrClass,desiredClass){if(ptrClass===desiredClass){return ptr}if(undefined===desiredClass.baseClass){return null}var rv=downcastPointer(ptr,ptrClass,desiredClass.baseClass);if(rv===null){return null}return desiredClass.downcast(rv)}var registeredPointers={};function getInheritedInstanceCount(){return Object.keys(registeredInstances).length}function getLiveInheritedInstances(){var rv=[];for(var k in registeredInstances){if(registeredInstances.hasOwnProperty(k)){rv.push(registeredInstances[k]);}}return rv}var deletionQueue=[];function flushPendingDeletes(){while(deletionQueue.length){var obj=deletionQueue.pop();obj.$$.deleteScheduled=false;obj["delete"]();}}var delayFunction=undefined;function setDelayFunction(fn){delayFunction=fn;if(deletionQueue.length&&delayFunction){delayFunction(flushPendingDeletes);}}function init_embind(){Module["getInheritedInstanceCount"]=getInheritedInstanceCount;Module["getLiveInheritedInstances"]=getLiveInheritedInstances;Module["flushPendingDeletes"]=flushPendingDeletes;Module["setDelayFunction"]=setDelayFunction;}var registeredInstances={};function getBasestPointer(class_,ptr){if(ptr===undefined){throwBindingError("ptr should not be undefined");}while(class_.baseClass){ptr=class_.upcast(ptr);class_=class_.baseClass;}return ptr}function getInheritedInstance(class_,ptr){ptr=getBasestPointer(class_,ptr);return registeredInstances[ptr]}function makeClassHandle(prototype,record){if(!record.ptrType||!record.ptr){throwInternalError("makeClassHandle requires ptr and ptrType");}var hasSmartPtrType=!!record.smartPtrType;var hasSmartPtr=!!record.smartPtr;if(hasSmartPtrType!==hasSmartPtr){throwInternalError("Both smartPtrType and smartPtr must be specified");}record.count={value:1};return attachFinalizer(Object.create(prototype,{$$:{value:record}}))}function RegisteredPointer_fromWireType(ptr){var rawPointer=this.getPointee(ptr);if(!rawPointer){this.destructor(ptr);return null}var registeredInstance=getInheritedInstance(this.registeredClass,rawPointer);if(undefined!==registeredInstance){if(0===registeredInstance.$$.count.value){registeredInstance.$$.ptr=rawPointer;registeredInstance.$$.smartPtr=ptr;return registeredInstance["clone"]()}else {var rv=registeredInstance["clone"]();this.destructor(ptr);return rv}}function makeDefaultHandle(){if(this.isSmartPointer){return makeClassHandle(this.registeredClass.instancePrototype,{ptrType:this.pointeeType,ptr:rawPointer,smartPtrType:this,smartPtr:ptr})}else {return makeClassHandle(this.registeredClass.instancePrototype,{ptrType:this,ptr:ptr})}}var actualType=this.registeredClass.getActualType(rawPointer);var registeredPointerRecord=registeredPointers[actualType];if(!registeredPointerRecord){return makeDefaultHandle.call(this)}var toType;if(this.isConst){toType=registeredPointerRecord.constPointerType;}else {toType=registeredPointerRecord.pointerType;}var dp=downcastPointer(rawPointer,this.registeredClass,toType.registeredClass);if(dp===null){return makeDefaultHandle.call(this)}if(this.isSmartPointer){return makeClassHandle(toType.registeredClass.instancePrototype,{ptrType:toType,ptr:dp,smartPtrType:this,smartPtr:ptr})}else {return makeClassHandle(toType.registeredClass.instancePrototype,{ptrType:toType,ptr:dp})}}function attachFinalizer(handle){if("undefined"===typeof FinalizationRegistry){attachFinalizer=handle=>handle;return handle}finalizationRegistry=new FinalizationRegistry(info=>{releaseClassHandle(info.$$);});attachFinalizer=handle=>{var $$=handle.$$;var hasSmartPtr=!!$$.smartPtr;if(hasSmartPtr){var info={$$:$$};finalizationRegistry.register(handle,info,handle);}return handle};detachFinalizer=handle=>finalizationRegistry.unregister(handle);return attachFinalizer(handle)}function ClassHandle_clone(){if(!this.$$.ptr){throwInstanceAlreadyDeleted(this);}if(this.$$.preservePointerOnDelete){this.$$.count.value+=1;return this}else {var clone=attachFinalizer(Object.create(Object.getPrototypeOf(this),{$$:{value:shallowCopyInternalPointer(this.$$)}}));clone.$$.count.value+=1;clone.$$.deleteScheduled=false;return clone}}function ClassHandle_delete(){if(!this.$$.ptr){throwInstanceAlreadyDeleted(this);}if(this.$$.deleteScheduled&&!this.$$.preservePointerOnDelete){throwBindingError("Object already scheduled for deletion");}detachFinalizer(this);releaseClassHandle(this.$$);if(!this.$$.preservePointerOnDelete){this.$$.smartPtr=undefined;this.$$.ptr=undefined;}}function ClassHandle_isDeleted(){return !this.$$.ptr}function ClassHandle_deleteLater(){if(!this.$$.ptr){throwInstanceAlreadyDeleted(this);}if(this.$$.deleteScheduled&&!this.$$.preservePointerOnDelete){throwBindingError("Object already scheduled for deletion");}deletionQueue.push(this);if(deletionQueue.length===1&&delayFunction){delayFunction(flushPendingDeletes);}this.$$.deleteScheduled=true;return this}function init_ClassHandle(){ClassHandle.prototype["isAliasOf"]=ClassHandle_isAliasOf;ClassHandle.prototype["clone"]=ClassHandle_clone;ClassHandle.prototype["delete"]=ClassHandle_delete;ClassHandle.prototype["isDeleted"]=ClassHandle_isDeleted;ClassHandle.prototype["deleteLater"]=ClassHandle_deleteLater;}function ClassHandle(){}function ensureOverloadTable(proto,methodName,humanName){if(undefined===proto[methodName].overloadTable){var prevFunc=proto[methodName];proto[methodName]=function(){if(!proto[methodName].overloadTable.hasOwnProperty(arguments.length)){throwBindingError("Function '"+humanName+"' called with an invalid number of arguments ("+arguments.length+") - expects one of ("+proto[methodName].overloadTable+")!");}return proto[methodName].overloadTable[arguments.length].apply(this,arguments)};proto[methodName].overloadTable=[];proto[methodName].overloadTable[prevFunc.argCount]=prevFunc;}}function exposePublicSymbol(name,value,numArguments){if(Module.hasOwnProperty(name)){if(undefined===numArguments||undefined!==Module[name].overloadTable&&undefined!==Module[name].overloadTable[numArguments]){throwBindingError("Cannot register public name '"+name+"' twice");}ensureOverloadTable(Module,name,name);if(Module.hasOwnProperty(numArguments)){throwBindingError("Cannot register multiple overloads of a function with the same number of arguments ("+numArguments+")!");}Module[name].overloadTable[numArguments]=value;}else {Module[name]=value;if(undefined!==numArguments){Module[name].numArguments=numArguments;}}}function RegisteredClass(name,constructor,instancePrototype,rawDestructor,baseClass,getActualType,upcast,downcast){this.name=name;this.constructor=constructor;this.instancePrototype=instancePrototype;this.rawDestructor=rawDestructor;this.baseClass=baseClass;this.getActualType=getActualType;this.upcast=upcast;this.downcast=downcast;this.pureVirtualFunctions=[];}function upcastPointer(ptr,ptrClass,desiredClass){while(ptrClass!==desiredClass){if(!ptrClass.upcast){throwBindingError("Expected null or instance of "+desiredClass.name+", got an instance of "+ptrClass.name);}ptr=ptrClass.upcast(ptr);ptrClass=ptrClass.baseClass;}return ptr}function constNoSmartPtrRawPointerToWireType(destructors,handle){if(handle===null){if(this.isReference){throwBindingError("null is not a valid "+this.name);}return 0}if(!handle.$$){throwBindingError('Cannot pass "'+embindRepr(handle)+'" as a '+this.name);}if(!handle.$$.ptr){throwBindingError("Cannot pass deleted object as a pointer of type "+this.name);}var handleClass=handle.$$.ptrType.registeredClass;var ptr=upcastPointer(handle.$$.ptr,handleClass,this.registeredClass);return ptr}function genericPointerToWireType(destructors,handle){var ptr;if(handle===null){if(this.isReference){throwBindingError("null is not a valid "+this.name);}if(this.isSmartPointer){ptr=this.rawConstructor();if(destructors!==null){destructors.push(this.rawDestructor,ptr);}return ptr}else {return 0}}if(!handle.$$){throwBindingError('Cannot pass "'+embindRepr(handle)+'" as a '+this.name);}if(!handle.$$.ptr){throwBindingError("Cannot pass deleted object as a pointer of type "+this.name);}if(!this.isConst&&handle.$$.ptrType.isConst){throwBindingError("Cannot convert argument of type "+(handle.$$.smartPtrType?handle.$$.smartPtrType.name:handle.$$.ptrType.name)+" to parameter type "+this.name);}var handleClass=handle.$$.ptrType.registeredClass;ptr=upcastPointer(handle.$$.ptr,handleClass,this.registeredClass);if(this.isSmartPointer){if(undefined===handle.$$.smartPtr){throwBindingError("Passing raw pointer to smart pointer is illegal");}switch(this.sharingPolicy){case 0:if(handle.$$.smartPtrType===this){ptr=handle.$$.smartPtr;}else {throwBindingError("Cannot convert argument of type "+(handle.$$.smartPtrType?handle.$$.smartPtrType.name:handle.$$.ptrType.name)+" to parameter type "+this.name);}break;case 1:ptr=handle.$$.smartPtr;break;case 2:if(handle.$$.smartPtrType===this){ptr=handle.$$.smartPtr;}else {var clonedHandle=handle["clone"]();ptr=this.rawShare(ptr,Emval.toHandle(function(){clonedHandle["delete"]();}));if(destructors!==null){destructors.push(this.rawDestructor,ptr);}}break;default:throwBindingError("Unsupporting sharing policy");}}return ptr}function nonConstNoSmartPtrRawPointerToWireType(destructors,handle){if(handle===null){if(this.isReference){throwBindingError("null is not a valid "+this.name);}return 0}if(!handle.$$){throwBindingError('Cannot pass "'+embindRepr(handle)+'" as a '+this.name);}if(!handle.$$.ptr){throwBindingError("Cannot pass deleted object as a pointer of type "+this.name);}if(handle.$$.ptrType.isConst){throwBindingError("Cannot convert argument of type "+handle.$$.ptrType.name+" to parameter type "+this.name);}var handleClass=handle.$$.ptrType.registeredClass;var ptr=upcastPointer(handle.$$.ptr,handleClass,this.registeredClass);return ptr}function RegisteredPointer_getPointee(ptr){if(this.rawGetPointee){ptr=this.rawGetPointee(ptr);}return ptr}function RegisteredPointer_destructor(ptr){if(this.rawDestructor){this.rawDestructor(ptr);}}function RegisteredPointer_deleteObject(handle){if(handle!==null){handle["delete"]();}}function init_RegisteredPointer(){RegisteredPointer.prototype.getPointee=RegisteredPointer_getPointee;RegisteredPointer.prototype.destructor=RegisteredPointer_destructor;RegisteredPointer.prototype["argPackAdvance"]=8;RegisteredPointer.prototype["readValueFromPointer"]=simpleReadValueFromPointer;RegisteredPointer.prototype["deleteObject"]=RegisteredPointer_deleteObject;RegisteredPointer.prototype["fromWireType"]=RegisteredPointer_fromWireType;}function RegisteredPointer(name,registeredClass,isReference,isConst,isSmartPointer,pointeeType,sharingPolicy,rawGetPointee,rawConstructor,rawShare,rawDestructor){this.name=name;this.registeredClass=registeredClass;this.isReference=isReference;this.isConst=isConst;this.isSmartPointer=isSmartPointer;this.pointeeType=pointeeType;this.sharingPolicy=sharingPolicy;this.rawGetPointee=rawGetPointee;this.rawConstructor=rawConstructor;this.rawShare=rawShare;this.rawDestructor=rawDestructor;if(!isSmartPointer&&registeredClass.baseClass===undefined){if(isConst){this["toWireType"]=constNoSmartPtrRawPointerToWireType;this.destructorFunction=null;}else {this["toWireType"]=nonConstNoSmartPtrRawPointerToWireType;this.destructorFunction=null;}}else {this["toWireType"]=genericPointerToWireType;}}function replacePublicSymbol(name,value,numArguments){if(!Module.hasOwnProperty(name)){throwInternalError("Replacing nonexistant public symbol");}if(undefined!==Module[name].overloadTable&&undefined!==numArguments){Module[name].overloadTable[numArguments]=value;}else {Module[name]=value;Module[name].argCount=numArguments;}}function dynCallLegacy(sig,ptr,args){var f=Module["dynCall_"+sig];return args&&args.length?f.apply(null,[ptr].concat(args)):f.call(null,ptr)}function getWasmTableEntry(funcPtr){return wasmTable.get(funcPtr)}function dynCall(sig,ptr,args){if(sig.includes("j")){return dynCallLegacy(sig,ptr,args)}var rtn=getWasmTableEntry(ptr).apply(null,args);return rtn}function getDynCaller(sig,ptr){var argCache=[];return function(){argCache.length=0;Object.assign(argCache,arguments);return dynCall(sig,ptr,argCache)}}function embind__requireFunction(signature,rawFunction){signature=readLatin1String(signature);function makeDynCaller(){if(signature.includes("j")){return getDynCaller(signature,rawFunction)}return getWasmTableEntry(rawFunction)}var fp=makeDynCaller();if(typeof fp!="function"){throwBindingError("unknown function pointer with signature "+signature+": "+rawFunction);}return fp}var UnboundTypeError=undefined;function getTypeName(type){var ptr=___getTypeName(type);var rv=readLatin1String(ptr);_free(ptr);return rv}function throwUnboundTypeError(message,types){var unboundTypes=[];var seen={};function visit(type){if(seen[type]){return}if(registeredTypes[type]){return}if(typeDependencies[type]){typeDependencies[type].forEach(visit);return}unboundTypes.push(type);seen[type]=true;}types.forEach(visit);throw new UnboundTypeError(message+": "+unboundTypes.map(getTypeName).join([", "]))}function __embind_register_class(rawType,rawPointerType,rawConstPointerType,baseClassRawType,getActualTypeSignature,getActualType,upcastSignature,upcast,downcastSignature,downcast,name,destructorSignature,rawDestructor){name=readLatin1String(name);getActualType=embind__requireFunction(getActualTypeSignature,getActualType);if(upcast){upcast=embind__requireFunction(upcastSignature,upcast);}if(downcast){downcast=embind__requireFunction(downcastSignature,downcast);}rawDestructor=embind__requireFunction(destructorSignature,rawDestructor);var legalFunctionName=makeLegalFunctionName(name);exposePublicSymbol(legalFunctionName,function(){throwUnboundTypeError("Cannot construct "+name+" due to unbound types",[baseClassRawType]);});whenDependentTypesAreResolved([rawType,rawPointerType,rawConstPointerType],baseClassRawType?[baseClassRawType]:[],function(base){base=base[0];var baseClass;var basePrototype;if(baseClassRawType){baseClass=base.registeredClass;basePrototype=baseClass.instancePrototype;}else {basePrototype=ClassHandle.prototype;}var constructor=createNamedFunction(legalFunctionName,function(){if(Object.getPrototypeOf(this)!==instancePrototype){throw new BindingError("Use 'new' to construct "+name)}if(undefined===registeredClass.constructor_body){throw new BindingError(name+" has no accessible constructor")}var body=registeredClass.constructor_body[arguments.length];if(undefined===body){throw new BindingError("Tried to invoke ctor of "+name+" with invalid number of parameters ("+arguments.length+") - expected ("+Object.keys(registeredClass.constructor_body).toString()+") parameters instead!")}return body.apply(this,arguments)});var instancePrototype=Object.create(basePrototype,{constructor:{value:constructor}});constructor.prototype=instancePrototype;var registeredClass=new RegisteredClass(name,constructor,instancePrototype,rawDestructor,baseClass,getActualType,upcast,downcast);var referenceConverter=new RegisteredPointer(name,registeredClass,true,false,false);var pointerConverter=new RegisteredPointer(name+"*",registeredClass,false,false,false);var constPointerConverter=new RegisteredPointer(name+" const*",registeredClass,false,true,false);registeredPointers[rawType]={pointerType:pointerConverter,constPointerType:constPointerConverter};replacePublicSymbol(legalFunctionName,constructor);return [referenceConverter,pointerConverter,constPointerConverter]});}function heap32VectorToArray(count,firstElement){var array=[];for(var i=0;i<count;i++){array.push(HEAPU32[firstElement+i*4>>2]);}return array}function new_(constructor,argumentList){if(!(constructor instanceof Function)){throw new TypeError("new_ called with constructor type "+typeof constructor+" which is not a function")}var dummy=createNamedFunction(constructor.name||"unknownFunctionName",function(){});dummy.prototype=constructor.prototype;var obj=new dummy;var r=constructor.apply(obj,argumentList);return r instanceof Object?r:obj}function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){var argCount=argTypes.length;if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");}var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=false;for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}var returns=argTypes[0].name!=="void";var argsList="";var argsListWired="";for(var i=0;i<argCount-2;++i){argsList+=(i!==0?", ":"")+"arg"+i;argsListWired+=(i!==0?", ":"")+"arg"+i+"Wired";}var invokerFnBody="return function "+makeLegalFunctionName(humanName)+"("+argsList+") {\n"+"if (arguments.length !== "+(argCount-2)+") {\n"+"throwBindingError('function "+humanName+" called with ' + arguments.length + ' arguments, expected "+(argCount-2)+" args!');\n"+"}\n";if(needsDestructorStack){invokerFnBody+="var destructors = [];\n";}var dtorStack=needsDestructorStack?"destructors":"null";var args1=["throwBindingError","invoker","fn","runDestructors","retType","classParam"];var args2=[throwBindingError,cppInvokerFunc,cppTargetFunc,runDestructors,argTypes[0],argTypes[1]];if(isClassMethodFunc){invokerFnBody+="var thisWired = classParam.toWireType("+dtorStack+", this);\n";}for(var i=0;i<argCount-2;++i){invokerFnBody+="var arg"+i+"Wired = argType"+i+".toWireType("+dtorStack+", arg"+i+"); // "+argTypes[i+2].name+"\n";args1.push("argType"+i);args2.push(argTypes[i+2]);}if(isClassMethodFunc){argsListWired="thisWired"+(argsListWired.length>0?", ":"")+argsListWired;}invokerFnBody+=(returns?"var rv = ":"")+"invoker(fn"+(argsListWired.length>0?", ":"")+argsListWired+");\n";if(needsDestructorStack){invokerFnBody+="runDestructors(destructors);\n";}else {for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){var paramName=i===1?"thisWired":"arg"+(i-2)+"Wired";if(argTypes[i].destructorFunction!==null){invokerFnBody+=paramName+"_dtor("+paramName+"); // "+argTypes[i].name+"\n";args1.push(paramName+"_dtor");args2.push(argTypes[i].destructorFunction);}}}if(returns){invokerFnBody+="var ret = retType.fromWireType(rv);\n"+"return ret;\n";}invokerFnBody+="}\n";args1.push(invokerFnBody);var invokerFunction=new_(Function,args1).apply(null,args2);return invokerFunction}function __embind_register_class_constructor(rawClassType,argCount,rawArgTypesAddr,invokerSignature,invoker,rawConstructor){assert(argCount>0);var rawArgTypes=heap32VectorToArray(argCount,rawArgTypesAddr);invoker=embind__requireFunction(invokerSignature,invoker);whenDependentTypesAreResolved([],[rawClassType],function(classType){classType=classType[0];var humanName="constructor "+classType.name;if(undefined===classType.registeredClass.constructor_body){classType.registeredClass.constructor_body=[];}if(undefined!==classType.registeredClass.constructor_body[argCount-1]){throw new BindingError("Cannot register multiple constructors with identical number of parameters ("+(argCount-1)+") for class '"+classType.name+"'! Overload resolution is currently only performed using the parameter count, not actual type info!")}classType.registeredClass.constructor_body[argCount-1]=()=>{throwUnboundTypeError("Cannot construct "+classType.name+" due to unbound types",rawArgTypes);};whenDependentTypesAreResolved([],rawArgTypes,function(argTypes){argTypes.splice(1,0,null);classType.registeredClass.constructor_body[argCount-1]=craftInvokerFunction(humanName,argTypes,null,invoker,rawConstructor);return []});return []});}function __embind_register_class_function(rawClassType,methodName,argCount,rawArgTypesAddr,invokerSignature,rawInvoker,context,isPureVirtual){var rawArgTypes=heap32VectorToArray(argCount,rawArgTypesAddr);methodName=readLatin1String(methodName);rawInvoker=embind__requireFunction(invokerSignature,rawInvoker);whenDependentTypesAreResolved([],[rawClassType],function(classType){classType=classType[0];var humanName=classType.name+"."+methodName;if(methodName.startsWith("@@")){methodName=Symbol[methodName.substring(2)];}if(isPureVirtual){classType.registeredClass.pureVirtualFunctions.push(methodName);}function unboundTypesHandler(){throwUnboundTypeError("Cannot call "+humanName+" due to unbound types",rawArgTypes);}var proto=classType.registeredClass.instancePrototype;var method=proto[methodName];if(undefined===method||undefined===method.overloadTable&&method.className!==classType.name&&method.argCount===argCount-2){unboundTypesHandler.argCount=argCount-2;unboundTypesHandler.className=classType.name;proto[methodName]=unboundTypesHandler;}else {ensureOverloadTable(proto,methodName,humanName);proto[methodName].overloadTable[argCount-2]=unboundTypesHandler;}whenDependentTypesAreResolved([],rawArgTypes,function(argTypes){var memberFunction=craftInvokerFunction(humanName,argTypes,classType,rawInvoker,context);if(undefined===proto[methodName].overloadTable){memberFunction.argCount=argCount-2;proto[methodName]=memberFunction;}else {proto[methodName].overloadTable[argCount-2]=memberFunction;}return []});return []});}var emval_free_list=[];var emval_handle_array=[{},{value:undefined},{value:null},{value:true},{value:false}];function __emval_decref(handle){if(handle>4&&0===--emval_handle_array[handle].refcount){emval_handle_array[handle]=undefined;emval_free_list.push(handle);}}function count_emval_handles(){var count=0;for(var i=5;i<emval_handle_array.length;++i){if(emval_handle_array[i]!==undefined){++count;}}return count}function get_first_emval(){for(var i=5;i<emval_handle_array.length;++i){if(emval_handle_array[i]!==undefined){return emval_handle_array[i]}}return null}function init_emval(){Module["count_emval_handles"]=count_emval_handles;Module["get_first_emval"]=get_first_emval;}var Emval={toValue:handle=>{if(!handle){throwBindingError("Cannot use deleted val. handle = "+handle);}return emval_handle_array[handle].value},toHandle:value=>{switch(value){case undefined:return 1;case null:return 2;case true:return 3;case false:return 4;default:{var handle=emval_free_list.length?emval_free_list.pop():emval_handle_array.length;emval_handle_array[handle]={refcount:1,value:value};return handle}}}};function __embind_register_emval(rawType,name){name=readLatin1String(name);registerType(rawType,{name:name,"fromWireType":function(handle){var rv=Emval.toValue(handle);__emval_decref(handle);return rv},"toWireType":function(destructors,value){return Emval.toHandle(value)},"argPackAdvance":8,"readValueFromPointer":simpleReadValueFromPointer,destructorFunction:null});}function enumReadValueFromPointer(name,shift,signed){switch(shift){case 0:return function(pointer){var heap=signed?HEAP8:HEAPU8;return this["fromWireType"](heap[pointer])};case 1:return function(pointer){var heap=signed?HEAP16:HEAPU16;return this["fromWireType"](heap[pointer>>1])};case 2:return function(pointer){var heap=signed?HEAP32:HEAPU32;return this["fromWireType"](heap[pointer>>2])};default:throw new TypeError("Unknown integer type: "+name)}}function __embind_register_enum(rawType,name,size,isSigned){var shift=getShiftFromSize(size);name=readLatin1String(name);function ctor(){}ctor.values={};registerType(rawType,{name:name,constructor:ctor,"fromWireType":function(c){return this.constructor.values[c]},"toWireType":function(destructors,c){return c.value},"argPackAdvance":8,"readValueFromPointer":enumReadValueFromPointer(name,shift,isSigned),destructorFunction:null});exposePublicSymbol(name,ctor);}function requireRegisteredType(rawType,humanName){var impl=registeredTypes[rawType];if(undefined===impl){throwBindingError(humanName+" has unknown type "+getTypeName(rawType));}return impl}function __embind_register_enum_value(rawEnumType,name,enumValue){var enumType=requireRegisteredType(rawEnumType,"enum");name=readLatin1String(name);var Enum=enumType.constructor;var Value=Object.create(enumType.constructor.prototype,{value:{value:enumValue},constructor:{value:createNamedFunction(enumType.name+"_"+name,function(){})}});Enum.values[enumValue]=Value;Enum[name]=Value;}function embindRepr(v){if(v===null){return "null"}var t=typeof v;if(t==="object"||t==="array"||t==="function"){return v.toString()}else {return ""+v}}function floatReadValueFromPointer(name,shift){switch(shift){case 2:return function(pointer){return this["fromWireType"](HEAPF32[pointer>>2])};case 3:return function(pointer){return this["fromWireType"](HEAPF64[pointer>>3])};default:throw new TypeError("Unknown float type: "+name)}}function __embind_register_float(rawType,name,size){var shift=getShiftFromSize(size);name=readLatin1String(name);registerType(rawType,{name:name,"fromWireType":function(value){return value},"toWireType":function(destructors,value){return value},"argPackAdvance":8,"readValueFromPointer":floatReadValueFromPointer(name,shift),destructorFunction:null});}function integerReadValueFromPointer(name,shift,signed){switch(shift){case 0:return signed?function readS8FromPointer(pointer){return HEAP8[pointer]}:function readU8FromPointer(pointer){return HEAPU8[pointer]};case 1:return signed?function readS16FromPointer(pointer){return HEAP16[pointer>>1]}:function readU16FromPointer(pointer){return HEAPU16[pointer>>1]};case 2:return signed?function readS32FromPointer(pointer){return HEAP32[pointer>>2]}:function readU32FromPointer(pointer){return HEAPU32[pointer>>2]};default:throw new TypeError("Unknown integer type: "+name)}}function __embind_register_integer(primitiveType,name,size,minRange,maxRange){name=readLatin1String(name);var shift=getShiftFromSize(size);var fromWireType=value=>value;if(minRange===0){var bitshift=32-8*size;fromWireType=value=>value<<bitshift>>>bitshift;}var isUnsignedType=name.includes("unsigned");var checkAssertions=(value,toTypeName)=>{};var toWireType;if(isUnsignedType){toWireType=function(destructors,value){checkAssertions(value,this.name);return value>>>0};}else {toWireType=function(destructors,value){checkAssertions(value,this.name);return value};}registerType(primitiveType,{name:name,"fromWireType":fromWireType,"toWireType":toWireType,"argPackAdvance":8,"readValueFromPointer":integerReadValueFromPointer(name,shift,minRange!==0),destructorFunction:null});}function __embind_register_memory_view(rawType,dataTypeIndex,name){var typeMapping=[Int8Array,Uint8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array];var TA=typeMapping[dataTypeIndex];function decodeMemoryView(handle){handle=handle>>2;var heap=HEAPU32;var size=heap[handle];var data=heap[handle+1];return new TA(buffer,data,size)}name=readLatin1String(name);registerType(rawType,{name:name,"fromWireType":decodeMemoryView,"argPackAdvance":8,"readValueFromPointer":decodeMemoryView},{ignoreDuplicateRegistrations:true});}function __embind_register_std_string(rawType,name){name=readLatin1String(name);var stdStringIsUTF8=name==="std::string";registerType(rawType,{name:name,"fromWireType":function(value){var length=HEAPU32[value>>2];var payload=value+4;var str;if(stdStringIsUTF8){var decodeStartPtr=payload;for(var i=0;i<=length;++i){var currentBytePtr=payload+i;if(i==length||HEAPU8[currentBytePtr]==0){var maxRead=currentBytePtr-decodeStartPtr;var stringSegment=UTF8ToString(decodeStartPtr,maxRead);if(str===undefined){str=stringSegment;}else {str+=String.fromCharCode(0);str+=stringSegment;}decodeStartPtr=currentBytePtr+1;}}}else {var a=new Array(length);for(var i=0;i<length;++i){a[i]=String.fromCharCode(HEAPU8[payload+i]);}str=a.join("");}_free(value);return str},"toWireType":function(destructors,value){if(value instanceof ArrayBuffer){value=new Uint8Array(value);}var length;var valueIsOfTypeString=typeof value=="string";if(!(valueIsOfTypeString||value instanceof Uint8Array||value instanceof Uint8ClampedArray||value instanceof Int8Array)){throwBindingError("Cannot pass non-string to std::string");}if(stdStringIsUTF8&&valueIsOfTypeString){length=lengthBytesUTF8(value);}else {length=value.length;}var base=_malloc(4+length+1);var ptr=base+4;HEAPU32[base>>2]=length;if(stdStringIsUTF8&&valueIsOfTypeString){stringToUTF8(value,ptr,length+1);}else {if(valueIsOfTypeString){for(var i=0;i<length;++i){var charCode=value.charCodeAt(i);if(charCode>255){_free(ptr);throwBindingError("String has UTF-16 code units that do not fit in 8 bits");}HEAPU8[ptr+i]=charCode;}}else {for(var i=0;i<length;++i){HEAPU8[ptr+i]=value[i];}}}if(destructors!==null){destructors.push(_free,base);}return base},"argPackAdvance":8,"readValueFromPointer":simpleReadValueFromPointer,destructorFunction:function(ptr){_free(ptr);}});}var UTF16Decoder=typeof TextDecoder!="undefined"?new TextDecoder("utf-16le"):undefined;function UTF16ToString(ptr,maxBytesToRead){var endPtr=ptr;var idx=endPtr>>1;var maxIdx=idx+maxBytesToRead/2;while(!(idx>=maxIdx)&&HEAPU16[idx])++idx;endPtr=idx<<1;if(endPtr-ptr>32&&UTF16Decoder){return UTF16Decoder.decode(HEAPU8.subarray(ptr,endPtr))}else {var str="";for(var i=0;!(i>=maxBytesToRead/2);++i){var codeUnit=HEAP16[ptr+i*2>>1];if(codeUnit==0)break;str+=String.fromCharCode(codeUnit);}return str}}function stringToUTF16(str,outPtr,maxBytesToWrite){if(maxBytesToWrite===undefined){maxBytesToWrite=2147483647;}if(maxBytesToWrite<2)return 0;maxBytesToWrite-=2;var startPtr=outPtr;var numCharsToWrite=maxBytesToWrite<str.length*2?maxBytesToWrite/2:str.length;for(var i=0;i<numCharsToWrite;++i){var codeUnit=str.charCodeAt(i);HEAP16[outPtr>>1]=codeUnit;outPtr+=2;}HEAP16[outPtr>>1]=0;return outPtr-startPtr}function lengthBytesUTF16(str){return str.length*2}function UTF32ToString(ptr,maxBytesToRead){var i=0;var str="";while(!(i>=maxBytesToRead/4)){var utf32=HEAP32[ptr+i*4>>2];if(utf32==0)break;++i;if(utf32>=65536){var ch=utf32-65536;str+=String.fromCharCode(55296|ch>>10,56320|ch&1023);}else {str+=String.fromCharCode(utf32);}}return str}function stringToUTF32(str,outPtr,maxBytesToWrite){if(maxBytesToWrite===undefined){maxBytesToWrite=2147483647;}if(maxBytesToWrite<4)return 0;var startPtr=outPtr;var endPtr=startPtr+maxBytesToWrite-4;for(var i=0;i<str.length;++i){var codeUnit=str.charCodeAt(i);if(codeUnit>=55296&&codeUnit<=57343){var trailSurrogate=str.charCodeAt(++i);codeUnit=65536+((codeUnit&1023)<<10)|trailSurrogate&1023;}HEAP32[outPtr>>2]=codeUnit;outPtr+=4;if(outPtr+4>endPtr)break}HEAP32[outPtr>>2]=0;return outPtr-startPtr}function lengthBytesUTF32(str){var len=0;for(var i=0;i<str.length;++i){var codeUnit=str.charCodeAt(i);if(codeUnit>=55296&&codeUnit<=57343)++i;len+=4;}return len}function __embind_register_std_wstring(rawType,charSize,name){name=readLatin1String(name);var decodeString,encodeString,getHeap,lengthBytesUTF,shift;if(charSize===2){decodeString=UTF16ToString;encodeString=stringToUTF16;lengthBytesUTF=lengthBytesUTF16;getHeap=()=>HEAPU16;shift=1;}else if(charSize===4){decodeString=UTF32ToString;encodeString=stringToUTF32;lengthBytesUTF=lengthBytesUTF32;getHeap=()=>HEAPU32;shift=2;}registerType(rawType,{name:name,"fromWireType":function(value){var length=HEAPU32[value>>2];var HEAP=getHeap();var str;var decodeStartPtr=value+4;for(var i=0;i<=length;++i){var currentBytePtr=value+4+i*charSize;if(i==length||HEAP[currentBytePtr>>shift]==0){var maxReadBytes=currentBytePtr-decodeStartPtr;var stringSegment=decodeString(decodeStartPtr,maxReadBytes);if(str===undefined){str=stringSegment;}else {str+=String.fromCharCode(0);str+=stringSegment;}decodeStartPtr=currentBytePtr+charSize;}}_free(value);return str},"toWireType":function(destructors,value){if(!(typeof value=="string")){throwBindingError("Cannot pass non-string to C++ string type "+name);}var length=lengthBytesUTF(value);var ptr=_malloc(4+length+charSize);HEAPU32[ptr>>2]=length>>shift;encodeString(value,ptr+4,length+charSize);if(destructors!==null){destructors.push(_free,ptr);}return ptr},"argPackAdvance":8,"readValueFromPointer":simpleReadValueFromPointer,destructorFunction:function(ptr){_free(ptr);}});}function __embind_register_value_object(rawType,name,constructorSignature,rawConstructor,destructorSignature,rawDestructor){structRegistrations[rawType]={name:readLatin1String(name),rawConstructor:embind__requireFunction(constructorSignature,rawConstructor),rawDestructor:embind__requireFunction(destructorSignature,rawDestructor),fields:[]};}function __embind_register_value_object_field(structType,fieldName,getterReturnType,getterSignature,getter,getterContext,setterArgumentType,setterSignature,setter,setterContext){structRegistrations[structType].fields.push({fieldName:readLatin1String(fieldName),getterReturnType:getterReturnType,getter:embind__requireFunction(getterSignature,getter),getterContext:getterContext,setterArgumentType:setterArgumentType,setter:embind__requireFunction(setterSignature,setter),setterContext:setterContext});}function __embind_register_void(rawType,name){name=readLatin1String(name);registerType(rawType,{isVoid:true,name:name,"argPackAdvance":0,"fromWireType":function(){return undefined},"toWireType":function(destructors,o){return undefined}});}function __emscripten_date_now(){return Date.now()}var nowIsMonotonic=true;function __emscripten_get_now_is_monotonic(){return nowIsMonotonic}function emval_lookupTypes(argCount,argTypes){var a=new Array(argCount);for(var i=0;i<argCount;++i){a[i]=requireRegisteredType(HEAPU32[argTypes+i*POINTER_SIZE>>2],"parameter "+i);}return a}function __emval_call(handle,argCount,argTypes,argv){handle=Emval.toValue(handle);var types=emval_lookupTypes(argCount,argTypes);var args=new Array(argCount);for(var i=0;i<argCount;++i){var type=types[i];args[i]=type["readValueFromPointer"](argv);argv+=type["argPackAdvance"];}var rv=handle.apply(undefined,args);return Emval.toHandle(rv)}function __emval_incref(handle){if(handle>4){emval_handle_array[handle].refcount+=1;}}function __emval_take_value(type,arg){type=requireRegisteredType(type,"_emval_take_value");var v=type["readValueFromPointer"](arg);return Emval.toHandle(v)}function __gmtime_js(time,tmPtr){var date=new Date(HEAP32[time>>2]*1e3);HEAP32[tmPtr>>2]=date.getUTCSeconds();HEAP32[tmPtr+4>>2]=date.getUTCMinutes();HEAP32[tmPtr+8>>2]=date.getUTCHours();HEAP32[tmPtr+12>>2]=date.getUTCDate();HEAP32[tmPtr+16>>2]=date.getUTCMonth();HEAP32[tmPtr+20>>2]=date.getUTCFullYear()-1900;HEAP32[tmPtr+24>>2]=date.getUTCDay();var start=Date.UTC(date.getUTCFullYear(),0,1,0,0,0,0);var yday=(date.getTime()-start)/(1e3*60*60*24)|0;HEAP32[tmPtr+28>>2]=yday;}function __localtime_js(time,tmPtr){var date=new Date(HEAP32[time>>2]*1e3);HEAP32[tmPtr>>2]=date.getSeconds();HEAP32[tmPtr+4>>2]=date.getMinutes();HEAP32[tmPtr+8>>2]=date.getHours();HEAP32[tmPtr+12>>2]=date.getDate();HEAP32[tmPtr+16>>2]=date.getMonth();HEAP32[tmPtr+20>>2]=date.getFullYear()-1900;HEAP32[tmPtr+24>>2]=date.getDay();var start=new Date(date.getFullYear(),0,1);var yday=(date.getTime()-start.getTime())/(1e3*60*60*24)|0;HEAP32[tmPtr+28>>2]=yday;HEAP32[tmPtr+36>>2]=-(date.getTimezoneOffset()*60);var summerOffset=new Date(date.getFullYear(),6,1).getTimezoneOffset();var winterOffset=start.getTimezoneOffset();var dst=(summerOffset!=winterOffset&&date.getTimezoneOffset()==Math.min(winterOffset,summerOffset))|0;HEAP32[tmPtr+32>>2]=dst;}function __mktime_js(tmPtr){var date=new Date(HEAP32[tmPtr+20>>2]+1900,HEAP32[tmPtr+16>>2],HEAP32[tmPtr+12>>2],HEAP32[tmPtr+8>>2],HEAP32[tmPtr+4>>2],HEAP32[tmPtr>>2],0);var dst=HEAP32[tmPtr+32>>2];var guessedOffset=date.getTimezoneOffset();var start=new Date(date.getFullYear(),0,1);var summerOffset=new Date(date.getFullYear(),6,1).getTimezoneOffset();var winterOffset=start.getTimezoneOffset();var dstOffset=Math.min(winterOffset,summerOffset);if(dst<0){HEAP32[tmPtr+32>>2]=Number(summerOffset!=winterOffset&&dstOffset==guessedOffset);}else if(dst>0!=(dstOffset==guessedOffset)){var nonDstOffset=Math.max(winterOffset,summerOffset);var trueOffset=dst>0?dstOffset:nonDstOffset;date.setTime(date.getTime()+(trueOffset-guessedOffset)*6e4);}HEAP32[tmPtr+24>>2]=date.getDay();var yday=(date.getTime()-start.getTime())/(1e3*60*60*24)|0;HEAP32[tmPtr+28>>2]=yday;HEAP32[tmPtr>>2]=date.getSeconds();HEAP32[tmPtr+4>>2]=date.getMinutes();HEAP32[tmPtr+8>>2]=date.getHours();HEAP32[tmPtr+12>>2]=date.getDate();HEAP32[tmPtr+16>>2]=date.getMonth();return date.getTime()/1e3|0}function allocateUTF8(str){var size=lengthBytesUTF8(str)+1;var ret=_malloc(size);if(ret)stringToUTF8Array(str,HEAP8,ret,size);return ret}function _tzset_impl(timezone,daylight,tzname){var currentYear=(new Date).getFullYear();var winter=new Date(currentYear,0,1);var summer=new Date(currentYear,6,1);var winterOffset=winter.getTimezoneOffset();var summerOffset=summer.getTimezoneOffset();var stdTimezoneOffset=Math.max(winterOffset,summerOffset);HEAP32[timezone>>2]=stdTimezoneOffset*60;HEAP32[daylight>>2]=Number(winterOffset!=summerOffset);function extractZone(date){var match=date.toTimeString().match(/\(([A-Za-z ]+)\)$/);return match?match[1]:"GMT"}var winterName=extractZone(winter);var summerName=extractZone(summer);var winterNamePtr=allocateUTF8(winterName);var summerNamePtr=allocateUTF8(summerName);if(summerOffset<winterOffset){HEAPU32[tzname>>2]=winterNamePtr;HEAPU32[tzname+4>>2]=summerNamePtr;}else {HEAPU32[tzname>>2]=summerNamePtr;HEAPU32[tzname+4>>2]=winterNamePtr;}}function __tzset_js(timezone,daylight,tzname){if(__tzset_js.called)return;__tzset_js.called=true;_tzset_impl(timezone,daylight,tzname);}function _abort(){abort("");}var _emscripten_get_now;_emscripten_get_now=()=>performance.now();function _emscripten_memcpy_big(dest,src,num){HEAPU8.copyWithin(dest,src,src+num);}function getHeapMax(){return 1073741824}function emscripten_realloc_buffer(size){try{wasmMemory.grow(size-buffer.byteLength+65535>>>16);updateGlobalBufferAndViews(wasmMemory.buffer);return 1}catch(e){}}function _emscripten_resize_heap(requestedSize){var oldSize=HEAPU8.length;requestedSize=requestedSize>>>0;var maxHeapSize=getHeapMax();if(requestedSize>maxHeapSize){return false}let alignUp=(x,multiple)=>x+(multiple-x%multiple)%multiple;for(var cutDown=1;cutDown<=4;cutDown*=2){var overGrownHeapSize=oldSize*(1+.2/cutDown);overGrownHeapSize=Math.min(overGrownHeapSize,requestedSize+100663296);var newSize=Math.min(maxHeapSize,alignUp(Math.max(requestedSize,overGrownHeapSize),65536));var replacement=emscripten_realloc_buffer(newSize);if(replacement){return true}}return false}var ENV={};function getExecutableName(){return thisProgram||"./this.program"}function getEnvStrings(){if(!getEnvStrings.strings){var lang=(typeof navigator=="object"&&navigator.languages&&navigator.languages[0]||"C").replace("-","_")+".UTF-8";var env={"USER":"web_user","LOGNAME":"web_user","PATH":"/","PWD":"/","HOME":"/home/web_user","LANG":lang,"_":getExecutableName()};for(var x in ENV){if(ENV[x]===undefined)delete env[x];else env[x]=ENV[x];}var strings=[];for(var x in env){strings.push(x+"="+env[x]);}getEnvStrings.strings=strings;}return getEnvStrings.strings}function writeAsciiToMemory(str,buffer,dontAddNull){for(var i=0;i<str.length;++i){HEAP8[buffer++>>0]=str.charCodeAt(i);}if(!dontAddNull)HEAP8[buffer>>0]=0;}function _environ_get(__environ,environ_buf){var bufSize=0;getEnvStrings().forEach(function(string,i){var ptr=environ_buf+bufSize;HEAPU32[__environ+i*4>>2]=ptr;writeAsciiToMemory(string,ptr);bufSize+=string.length+1;});return 0}function _environ_sizes_get(penviron_count,penviron_buf_size){var strings=getEnvStrings();HEAPU32[penviron_count>>2]=strings.length;var bufSize=0;strings.forEach(function(string){bufSize+=string.length+1;});HEAPU32[penviron_buf_size>>2]=bufSize;return 0}function _fd_close(fd){return 52}function _fd_read(fd,iov,iovcnt,pnum){return 52}function _fd_seek(fd,offset_low,offset_high,whence,newOffset){return 70}var printCharBuffers=[null,[],[]];function printChar(stream,curr){var buffer=printCharBuffers[stream];if(curr===0||curr===10){(stream===1?out:err)(UTF8ArrayToString(buffer,0));buffer.length=0;}else {buffer.push(curr);}}function _fd_write(fd,iov,iovcnt,pnum){var num=0;for(var i=0;i<iovcnt;i++){var ptr=HEAPU32[iov>>2];var len=HEAPU32[iov+4>>2];iov+=8;for(var j=0;j<len;j++){printChar(fd,HEAPU8[ptr+j]);}num+=len;}HEAPU32[pnum>>2]=num;return 0}function _setTempRet0(val){}function __isLeapYear(year){return year%4===0&&(year%100!==0||year%400===0)}function __arraySum(array,index){var sum=0;for(var i=0;i<=index;sum+=array[i++]){}return sum}var __MONTH_DAYS_LEAP=[31,29,31,30,31,30,31,31,30,31,30,31];var __MONTH_DAYS_REGULAR=[31,28,31,30,31,30,31,31,30,31,30,31];function __addDays(date,days){var newDate=new Date(date.getTime());while(days>0){var leap=__isLeapYear(newDate.getFullYear());var currentMonth=newDate.getMonth();var daysInCurrentMonth=(leap?__MONTH_DAYS_LEAP:__MONTH_DAYS_REGULAR)[currentMonth];if(days>daysInCurrentMonth-newDate.getDate()){days-=daysInCurrentMonth-newDate.getDate()+1;newDate.setDate(1);if(currentMonth<11){newDate.setMonth(currentMonth+1);}else {newDate.setMonth(0);newDate.setFullYear(newDate.getFullYear()+1);}}else {newDate.setDate(newDate.getDate()+days);return newDate}}return newDate}function intArrayFromString(stringy,dontAddNull,length){var len=length>0?length:lengthBytesUTF8(stringy)+1;var u8array=new Array(len);var numBytesWritten=stringToUTF8Array(stringy,u8array,0,u8array.length);if(dontAddNull)u8array.length=numBytesWritten;return u8array}function _strftime(s,maxsize,format,tm){var tm_zone=HEAP32[tm+40>>2];var date={tm_sec:HEAP32[tm>>2],tm_min:HEAP32[tm+4>>2],tm_hour:HEAP32[tm+8>>2],tm_mday:HEAP32[tm+12>>2],tm_mon:HEAP32[tm+16>>2],tm_year:HEAP32[tm+20>>2],tm_wday:HEAP32[tm+24>>2],tm_yday:HEAP32[tm+28>>2],tm_isdst:HEAP32[tm+32>>2],tm_gmtoff:HEAP32[tm+36>>2],tm_zone:tm_zone?UTF8ToString(tm_zone):""};var pattern=UTF8ToString(format);var EXPANSION_RULES_1={"%c":"%a %b %d %H:%M:%S %Y","%D":"%m/%d/%y","%F":"%Y-%m-%d","%h":"%b","%r":"%I:%M:%S %p","%R":"%H:%M","%T":"%H:%M:%S","%x":"%m/%d/%y","%X":"%H:%M:%S","%Ec":"%c","%EC":"%C","%Ex":"%m/%d/%y","%EX":"%H:%M:%S","%Ey":"%y","%EY":"%Y","%Od":"%d","%Oe":"%e","%OH":"%H","%OI":"%I","%Om":"%m","%OM":"%M","%OS":"%S","%Ou":"%u","%OU":"%U","%OV":"%V","%Ow":"%w","%OW":"%W","%Oy":"%y"};for(var rule in EXPANSION_RULES_1){pattern=pattern.replace(new RegExp(rule,"g"),EXPANSION_RULES_1[rule]);}var WEEKDAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];var MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];function leadingSomething(value,digits,character){var str=typeof value=="number"?value.toString():value||"";while(str.length<digits){str=character[0]+str;}return str}function leadingNulls(value,digits){return leadingSomething(value,digits,"0")}function compareByDay(date1,date2){function sgn(value){return value<0?-1:value>0?1:0}var compare;if((compare=sgn(date1.getFullYear()-date2.getFullYear()))===0){if((compare=sgn(date1.getMonth()-date2.getMonth()))===0){compare=sgn(date1.getDate()-date2.getDate());}}return compare}function getFirstWeekStartDate(janFourth){switch(janFourth.getDay()){case 0:return new Date(janFourth.getFullYear()-1,11,29);case 1:return janFourth;case 2:return new Date(janFourth.getFullYear(),0,3);case 3:return new Date(janFourth.getFullYear(),0,2);case 4:return new Date(janFourth.getFullYear(),0,1);case 5:return new Date(janFourth.getFullYear()-1,11,31);case 6:return new Date(janFourth.getFullYear()-1,11,30)}}function getWeekBasedYear(date){var thisDate=__addDays(new Date(date.tm_year+1900,0,1),date.tm_yday);var janFourthThisYear=new Date(thisDate.getFullYear(),0,4);var janFourthNextYear=new Date(thisDate.getFullYear()+1,0,4);var firstWeekStartThisYear=getFirstWeekStartDate(janFourthThisYear);var firstWeekStartNextYear=getFirstWeekStartDate(janFourthNextYear);if(compareByDay(firstWeekStartThisYear,thisDate)<=0){if(compareByDay(firstWeekStartNextYear,thisDate)<=0){return thisDate.getFullYear()+1}else {return thisDate.getFullYear()}}else {return thisDate.getFullYear()-1}}var EXPANSION_RULES_2={"%a":function(date){return WEEKDAYS[date.tm_wday].substring(0,3)},"%A":function(date){return WEEKDAYS[date.tm_wday]},"%b":function(date){return MONTHS[date.tm_mon].substring(0,3)},"%B":function(date){return MONTHS[date.tm_mon]},"%C":function(date){var year=date.tm_year+1900;return leadingNulls(year/100|0,2)},"%d":function(date){return leadingNulls(date.tm_mday,2)},"%e":function(date){return leadingSomething(date.tm_mday,2," ")},"%g":function(date){return getWeekBasedYear(date).toString().substring(2)},"%G":function(date){return getWeekBasedYear(date)},"%H":function(date){return leadingNulls(date.tm_hour,2)},"%I":function(date){var twelveHour=date.tm_hour;if(twelveHour==0)twelveHour=12;else if(twelveHour>12)twelveHour-=12;return leadingNulls(twelveHour,2)},"%j":function(date){return leadingNulls(date.tm_mday+__arraySum(__isLeapYear(date.tm_year+1900)?__MONTH_DAYS_LEAP:__MONTH_DAYS_REGULAR,date.tm_mon-1),3)},"%m":function(date){return leadingNulls(date.tm_mon+1,2)},"%M":function(date){return leadingNulls(date.tm_min,2)},"%n":function(){return "\n"},"%p":function(date){if(date.tm_hour>=0&&date.tm_hour<12){return "AM"}else {return "PM"}},"%S":function(date){return leadingNulls(date.tm_sec,2)},"%t":function(){return "\t"},"%u":function(date){return date.tm_wday||7},"%U":function(date){var days=date.tm_yday+7-date.tm_wday;return leadingNulls(Math.floor(days/7),2)},"%V":function(date){var val=Math.floor((date.tm_yday+7-(date.tm_wday+6)%7)/7);if((date.tm_wday+371-date.tm_yday-2)%7<=2){val++;}if(!val){val=52;var dec31=(date.tm_wday+7-date.tm_yday-1)%7;if(dec31==4||dec31==5&&__isLeapYear(date.tm_year%400-1)){val++;}}else if(val==53){var jan1=(date.tm_wday+371-date.tm_yday)%7;if(jan1!=4&&(jan1!=3||!__isLeapYear(date.tm_year)))val=1;}return leadingNulls(val,2)},"%w":function(date){return date.tm_wday},"%W":function(date){var days=date.tm_yday+7-(date.tm_wday+6)%7;return leadingNulls(Math.floor(days/7),2)},"%y":function(date){return (date.tm_year+1900).toString().substring(2)},"%Y":function(date){return date.tm_year+1900},"%z":function(date){var off=date.tm_gmtoff;var ahead=off>=0;off=Math.abs(off)/60;off=off/60*100+off%60;return (ahead?"+":"-")+String("0000"+off).slice(-4)},"%Z":function(date){return date.tm_zone},"%%":function(){return "%"}};pattern=pattern.replace(/%%/g,"\0\0");for(var rule in EXPANSION_RULES_2){if(pattern.includes(rule)){pattern=pattern.replace(new RegExp(rule,"g"),EXPANSION_RULES_2[rule](date));}}pattern=pattern.replace(/\0\0/g,"%");var bytes=intArrayFromString(pattern,false);if(bytes.length>maxsize){return 0}writeArrayToMemory(bytes,s);return bytes.length-1}function _strftime_l(s,maxsize,format,tm){return _strftime(s,maxsize,format,tm)}InternalError=Module["InternalError"]=extendError(Error,"InternalError");embind_init_charCodes();BindingError=Module["BindingError"]=extendError(Error,"BindingError");init_ClassHandle();init_embind();init_RegisteredPointer();UnboundTypeError=Module["UnboundTypeError"]=extendError(Error,"UnboundTypeError");init_emval();var asmLibraryArg={"f":___cxa_allocate_exception,"e":___cxa_throw,"s":___syscall_fcntl64,"G":___syscall_getcwd,"I":___syscall_ioctl,"t":___syscall_openat,"B":___syscall_rmdir,"C":___syscall_unlinkat,"g":__embind_finalize_value_object,"y":__embind_register_bigint,"R":__embind_register_bool,"m":__embind_register_class,"l":__embind_register_class_constructor,"a":__embind_register_class_function,"Q":__embind_register_emval,"E":__embind_register_enum,"w":__embind_register_enum_value,"v":__embind_register_float,"d":__embind_register_integer,"b":__embind_register_memory_view,"u":__embind_register_std_string,"p":__embind_register_std_wstring,"i":__embind_register_value_object,"c":__embind_register_value_object_field,"S":__embind_register_void,"k":__emscripten_date_now,"K":__emscripten_get_now_is_monotonic,"V":__emval_call,"U":__emval_decref,"q":__emval_incref,"n":__emval_take_value,"L":__gmtime_js,"M":__localtime_js,"N":__mktime_js,"O":__tzset_js,"h":_abort,"J":_emscripten_get_now,"P":_emscripten_memcpy_big,"A":_emscripten_resize_heap,"D":_environ_get,"F":_environ_sizes_get,"o":_fd_close,"H":_fd_read,"x":_fd_seek,"r":_fd_write,"j":_setTempRet0,"T":_strftime,"z":_strftime_l};createWasm();Module["___wasm_call_ctors"]=function(){return (Module["___wasm_call_ctors"]=Module["asm"]["X"]).apply(null,arguments)};var _malloc=Module["_malloc"]=function(){return (_malloc=Module["_malloc"]=Module["asm"]["Y"]).apply(null,arguments)};var _free=Module["_free"]=function(){return (_free=Module["_free"]=Module["asm"]["_"]).apply(null,arguments)};var ___getTypeName=Module["___getTypeName"]=function(){return (___getTypeName=Module["___getTypeName"]=Module["asm"]["$"]).apply(null,arguments)};Module["___embind_register_native_and_builtin_types"]=function(){return (Module["___embind_register_native_and_builtin_types"]=Module["asm"]["aa"]).apply(null,arguments)};var ___cxa_is_pointer_type=Module["___cxa_is_pointer_type"]=function(){return (___cxa_is_pointer_type=Module["___cxa_is_pointer_type"]=Module["asm"]["ba"]).apply(null,arguments)};Module["dynCall_jiji"]=function(){return (Module["dynCall_jiji"]=Module["asm"]["ca"]).apply(null,arguments)};Module["dynCall_viijii"]=function(){return (Module["dynCall_viijii"]=Module["asm"]["da"]).apply(null,arguments)};Module["dynCall_iiiiij"]=function(){return (Module["dynCall_iiiiij"]=Module["asm"]["ea"]).apply(null,arguments)};Module["dynCall_iiiiijj"]=function(){return (Module["dynCall_iiiiijj"]=Module["asm"]["fa"]).apply(null,arguments)};Module["dynCall_iiiiiijj"]=function(){return (Module["dynCall_iiiiiijj"]=Module["asm"]["ga"]).apply(null,arguments)};Module["dynCall_jijii"]=function(){return (Module["dynCall_jijii"]=Module["asm"]["ha"]).apply(null,arguments)};Module["dynCall_vijii"]=function(){return (Module["dynCall_vijii"]=Module["asm"]["ia"]).apply(null,arguments)};Module["dynCall_jij"]=function(){return (Module["dynCall_jij"]=Module["asm"]["ja"]).apply(null,arguments)};Module["dynCall_iij"]=function(){return (Module["dynCall_iij"]=Module["asm"]["ka"]).apply(null,arguments)};Module["dynCall_viji"]=function(){return (Module["dynCall_viji"]=Module["asm"]["la"]).apply(null,arguments)};Module["dynCall_jii"]=function(){return (Module["dynCall_jii"]=Module["asm"]["ma"]).apply(null,arguments)};var calledRun;dependenciesFulfilled=function runCaller(){if(!calledRun)run();if(!calledRun)dependenciesFulfilled=runCaller;};function run(args){if(runDependencies>0){return}preRun();if(runDependencies>0){return}function doRun(){if(calledRun)return;calledRun=true;Module["calledRun"]=true;if(ABORT)return;initRuntime();readyPromiseResolve(Module);if(Module["onRuntimeInitialized"])Module["onRuntimeInitialized"]();postRun();}if(Module["setStatus"]){Module["setStatus"]("Running...");setTimeout(function(){setTimeout(function(){Module["setStatus"]("");},1);doRun();},1);}else {doRun();}}if(Module["preInit"]){if(typeof Module["preInit"]=="function")Module["preInit"]=[Module["preInit"]];while(Module["preInit"].length>0){Module["preInit"].pop()();}}run();function wasmSIMDSupported(){const simdTest=Uint8Array.from([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]);return WebAssembly.validate(simdTest)}if(wasmSIMDSupported()){ENV.DOTPRODUCT="sse";}


      return Module.ready
    }
    );
    })();

    /**
     * Extract the pixel data from an ImageBitmap.
     */
    function imageDataFromBitmap(bitmap) {
        let canvas;
        // @ts-expect-error - OffscreenCanvas API is missing
        if (typeof OffscreenCanvas !== "undefined") {
            // @ts-expect-error - OffscreenCanvas API is missing
            canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        }
        else if (typeof HTMLCanvasElement !== "undefined") {
            const canvasEl = document.createElement("canvas");
            canvasEl.width = bitmap.width;
            canvasEl.height = bitmap.height;
            canvas = canvasEl;
        }
        else {
            throw new Error("No canvas implementation available");
        }
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
    }

    // @ts-ignore - Don't error if library hasn't been built yet.
    /**
     * Create a JS array from a std::vector wrapper created by Embind.
     */
    function jsArrayFromStdVector(vec) {
        const size = vec.size();
        const result = [];
        for (let i = 0; i < size; i++) {
            result.push(vec.get(i));
        }
        return result;
    }
    /**
     * Low-level synchronous API for performing OCR.
     *
     * Instances are constructed using {@link createOCREngine}.
     */
    class OCREngine {
        /**
         * Initialize the OCREngine.
         *
         * Use {@link createOCREngine} rather than calling this directly.
         *
         * @param tessLib - Emscripten entry point for the compiled WebAssembly module.
         * @param progressChannel - Channel used to report progress
         *   updates when OCREngine is run on a background thread
         */
        constructor(tessLib, progressChannel) {
            this._tesseractLib = tessLib;
            this._engine = new tessLib.OCREngine();
            this._modelLoaded = false;
            this._imageLoaded = false;
            this._progressChannel = progressChannel;
        }
        /**
         * Shut down the OCR engine and free up resources.
         */
        destroy() {
            this._engine.delete();
            this._engine = null;
        }
        /**
         * Get the value, represented as a string, of a Tesseract configuration variable.
         *
         * See {@link setVariable} for available variables.
         */
        getVariable(name) {
            const result = this._engine.getVariable(name);
            if (!result.success) {
                throw new Error(`Unable to get variable ${name}`);
            }
            return result.value;
        }
        /**
         * Set the value of a Tesseract configuration variable.
         *
         * For a list of configuration variables, see
         * https://github.com/tesseract-ocr/tesseract/blob/677f5822f247ccb12b4e026265e88b959059fb59/src/ccmain/tesseractclass.cpp#L53
         *
         * If you have Tesseract installed locally, executing `tesseract --print-parameters`
         * will also display a list of configuration variables.
         */
        setVariable(name, value) {
            const result = this._engine.setVariable(name, value);
            if (result.error) {
                throw new Error(`Unable to set variable ${name}`);
            }
        }
        /**
         * Load a trained text recognition model.
         */
        loadModel(model) {
            const modelArray = model instanceof ArrayBuffer ? new Uint8Array(model) : model;
            const result = this._engine.loadModel(modelArray);
            if (result.error) {
                throw new Error("Text recognition model failed to load");
            }
            this._modelLoaded = true;
        }
        /**
         * Load a document image for processing by subsequent operations.
         *
         * This is a cheap operation as expensive processing is deferred until
         * bounding boxes or text content is requested.
         */
        loadImage(image) {
            let imageData;
            if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
                imageData = imageDataFromBitmap(image);
            }
            else {
                imageData = image;
            }
            if (imageData.data.length < imageData.width * imageData.height * 4) {
                throw new Error("Image data length does not match width/height");
            }
            if (imageData.width <= 0 || imageData.height <= 0) {
                throw new Error("Image width or height is zero");
            }
            // Free up resources used by the previous image, if any. Doing this before
            // creating the buffer for the new image reduces peak memory usage.
            this._engine.clearImage();
            // Allocate a temporary internal image for transfering the image data into
            // Tesseract
            const engineImage = new this._tesseractLib.Image(imageData.width, imageData.height);
            const engineImageBuf = engineImage.data();
            engineImageBuf.set(new Uint32Array(imageData.data.buffer));
            // Load the image. This will take a copy of the image within Tesseract, so
            // we can release the original afterwards.
            const result = this._engine.loadImage(engineImage);
            engineImage.delete();
            if (result.error) {
                throw new Error("Failed to load image");
            }
            this._imageLoaded = true;
        }
        /**
         * Clear the current image and text recognition results.
         *
         * This will clear the loaded image data internally, but keep the text
         * recognition model loaded.
         *
         * At present there is no way to shrink WebAssembly memory, so this will not
         * return the memory used by the image to the OS/browser. To release memory,
         * the `OCREngine` instance needs to be destroyed via {@link destroy}.
         */
        clearImage() {
            this._engine.clearImage();
            this._imageLoaded = false;
        }
        /**
         * Perform layout analysis on the current image, if not already done, and
         * return bounding boxes for a given unit of text.
         *
         * This operation is relatively cheap compared to text recognition, so can
         * provide much faster results if only the location of lines/words etc. on
         * the page is required, not the text content. This operation can also be
         * performed before a text recognition model is loaded.
         *
         * This method may return a different number/positions of words on a line
         * compared to {@link getTextBoxes} due to the simpler analysis. After full
         * OCR has been performed by {@link getTextBoxes} or {@link getText}, this
         * method should return the same results.
         */
        getBoundingBoxes(unit) {
            this._checkImageLoaded();
            const textUnit = this._textUnitForUnit(unit);
            return jsArrayFromStdVector(this._engine.getBoundingBoxes(textUnit));
        }
        /**
         * Perform layout analysis and text recognition on the current image, if
         * not already done, and return bounding boxes and text content for a given
         * unit of text.
         *
         * A text recognition model must be loaded with {@link loadModel} before this
         * is called.
         */
        getTextBoxes(unit, onProgress) {
            this._checkImageLoaded();
            this._checkModelLoaded();
            const textUnit = this._textUnitForUnit(unit);
            return jsArrayFromStdVector(this._engine.getTextBoxes(textUnit, (progress) => {
                var _a;
                onProgress === null || onProgress === void 0 ? void 0 : onProgress(progress);
                (_a = this._progressChannel) === null || _a === void 0 ? void 0 : _a.postMessage({ progress });
            }));
        }
        /**
         * Perform layout analysis and text recognition on the current image, if
         * not already done, and return the page text as a string.
         *
         * A text recognition model must be loaded with {@link loadModel} before this
         * is called.
         */
        getText(onProgress) {
            this._checkImageLoaded();
            this._checkModelLoaded();
            return this._engine.getText((progress) => {
                var _a;
                onProgress === null || onProgress === void 0 ? void 0 : onProgress(progress);
                (_a = this._progressChannel) === null || _a === void 0 ? void 0 : _a.postMessage({ progress });
            });
        }
        /**
         * Perform layout analysis and text recognition on the current image, if
         * not already done, and return the page text in hOCR format.
         *
         * A text recognition model must be loaded with {@link loadModel} before this
         * is called.
         */
        getHOCR(onProgress) {
            this._checkImageLoaded();
            this._checkModelLoaded();
            return this._engine.getHOCR((progress) => {
                var _a;
                onProgress === null || onProgress === void 0 ? void 0 : onProgress(progress);
                (_a = this._progressChannel) === null || _a === void 0 ? void 0 : _a.postMessage({ progress });
            });
        }
        /**
         * Attempt to determine the orientation of the document image in degrees.
         *
         * This currently uses a simplistic algorithm [1] which is designed for
         * non-uppercase Latin text. It will likely perform badly for other scripts or
         * if the text is all uppercase.
         *
         * [1] See http://www.leptonica.org/papers/skew-measurement.pdf
         */
        getOrientation() {
            this._checkImageLoaded();
            return this._engine.getOrientation();
        }
        _checkModelLoaded() {
            if (!this._modelLoaded) {
                throw new Error("No text recognition model loaded");
            }
        }
        _checkImageLoaded() {
            if (!this._imageLoaded) {
                throw new Error("No image loaded");
            }
        }
        _textUnitForUnit(unit) {
            const { TextUnit } = this._tesseractLib;
            switch (unit) {
                case "word":
                    return TextUnit.Word;
                case "line":
                    return TextUnit.Line;
                default:
                    throw new Error("Invalid text unit");
            }
        }
    }
    function wasmSIMDSupported() {
        // Tiny WebAssembly file generated from the following source using `wat2wasm`:
        //
        // (module
        //   (func (result v128)
        //     i32.const 0
        //     i8x16.splat
        //     i8x16.popcnt
        //   )
        // )
        const simdTest = Uint8Array.from([
            0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1,
            8, 0, 65, 0, 253, 15, 253, 98, 11,
        ]);
        return WebAssembly.validate(simdTest);
    }
    function resolve(path, baseURL) {
        return new URL(path, baseURL).href;
    }
    /**
     * Return true if the current JS runtime supports all the WebAssembly features
     * needed for the "fast" WebAssembly build. If not, the "fallback" version must
     * be used.
     */
    function supportsFastBuild() {
        return wasmSIMDSupported();
    }
    /**
     * Initialize the OCR library and return a new {@link OCREngine}.
     */
    async function createOCREngine({ wasmBinary, progressChannel, } = {}) {
        if (!wasmBinary) {
            const wasmPath = supportsFastBuild()
                ? "./tesseract-core.wasm"
                : "./tesseract-core-fallback.wasm";
            // nb. If this code is included in a non-ESM bundle, Rollup will replace
            // `import.meta.url` with code that uses `document.currentScript` /
            // `location.href`.
            const wasmURL = resolve(wasmPath, (typeof document === 'undefined' && typeof location === 'undefined' ? new (require('u' + 'rl').URL)('file:' + __filename).href : typeof document === 'undefined' ? location.href : (document.currentScript && document.currentScript.src || new URL('tesseract-worker.js', document.baseURI).href)));
            const wasmBinaryResponse = await fetch(wasmURL);
            wasmBinary = await wasmBinaryResponse.arrayBuffer();
        }
        const tessLib = await Module({ wasmBinary });
        return new OCREngine(tessLib, progressChannel);
    }

    const workerAPI = {
        /**
         * @param progressChannel - Channel to send progress updates over. This is
         *   sent separately from the options argument to enable comlink to transfer it.
         */
        createOCREngine: async ({ wasmBinary }, progressChannel) => {
            const engine = await createOCREngine({ wasmBinary, progressChannel });
            return proxy(engine);
        },
    };
    expose(workerAPI);

}));
