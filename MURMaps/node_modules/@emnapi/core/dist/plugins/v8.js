//#region src/emnapi/v8.js
function v8 (emnapiPluginCtx) {
  const { emnapiCtx, emnapiExternalMemory, emnapiString } = emnapiPluginCtx;
  var mod = (function (exports, emscripten_runtime) {

    //#region src/v8/array.ts
    /**
     * @__deps $emnapiCtx
     * @__sig ppi
     */
    function _v8_array_new(context, value) {
        return emnapiCtx.napiValueFromJsValue(Array(value));
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_array_length(array) {
        const arr = emnapiCtx.jsValueFromNapiValue(array);
        return arr.length;
    }

    //#endregion src/v8/array.ts

    //#region src/v8/array_buffer.ts
    /**
     * @__sig vpppp
     * @__deps $emnapiCtx
     * @__deps $emnapiExternalMemory
     */
    function _v8_backing_store_set(backing_store, buffer, data, byte_length) {
        backing_store >>>= 0;
        buffer >>>= 0;
        data >>>= 0;
        byte_length >>>= 0;
        const arrayBuffer = emnapiCtx.jsValueFromNapiValue(buffer);
        emnapiExternalMemory.setBackingStore(backing_store, data, byte_length, arrayBuffer);
    }
    /**
     * @__sig pp
     * @__deps $emnapiExternalMemory
     */
    function _v8_backing_store_data(backing_store) {
        backing_store >>>= 0;
        return emnapiExternalMemory.getBackingStoreData(backing_store);
    }
    /**
     * @__sig pp
     * @__deps $emnapiExternalMemory
     */
    function _v8_backing_store_byte_length(backing_store) {
        backing_store >>>= 0;
        return emnapiExternalMemory.getBackingStoreByteLength(backing_store);
    }
    /**
     * @__sig vp
     * @__deps $emnapiExternalMemory
     */
    function _v8_backing_store_delete(backing_store) {
        backing_store >>>= 0;
        emnapiExternalMemory.deleteBackingStore(backing_store);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_array_buffer_view_buffer(view) {
        const value = emnapiCtx.jsValueFromNapiValue(view);
        if (value == null || !ArrayBuffer.isView(value))
            return 0;
        return emnapiCtx.napiValueFromJsValue(value.buffer);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_array_buffer_view_byte_offset(view) {
        const value = emnapiCtx.jsValueFromNapiValue(view);
        return value == null || !ArrayBuffer.isView(value) ? 0 : value.byteOffset;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_array_buffer_view_byte_length(view) {
        const value = emnapiCtx.jsValueFromNapiValue(view);
        return value == null || !ArrayBuffer.isView(value) ? 0 : value.byteLength;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_array_buffer_byte_length(buffer) {
        const value = emnapiCtx.jsValueFromNapiValue(buffer);
        return value == null ? 0 : value.byteLength;
    }
    /**
     * @__deps $emnapiCtx
     * @__deps $emnapiExternalMemory
     * @__sig ppp
     */
    function _v8_array_buffer_get_backing_store(buffer, byte_length) {
        const value = emnapiCtx.jsValueFromNapiValue(buffer);
        if (value == null)
            return 0;
        // read the length before the copy is made (as napi_get_arraybuffer_info
        // does): another thread can grow a growable SharedArrayBuffer, and the
        // length must fit in the copy
        const byteLength = emnapiExternalMemory.bufferByteLength(value);
        const pointer = emnapiExternalMemory.getArrayBufferPointer(value, true).address;
        byte_length >>>= 0;
        if (byte_length) {
            var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
            GET_HEAP_DATA_VIEW().setUint32(byte_length, byteLength, true);
        }
        return pointer;
    }

    //#endregion src/v8/array_buffer.ts

    //#region src/v8/boolean.ts
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_boolean_value(value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        return jsValue ? 1 : 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppi
     */
    function _v8_boolean_object_new(isolate, value) {
        // eslint-disable-next-line no-new-wrappers
        return emnapiCtx.napiValueFromJsValue(new Boolean(value));
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_boolean_object_value_of(self) {
        const boolObj = emnapiCtx.jsValueFromNapiValue(self);
        return boolObj.valueOf() ? 1 : 0;
    }

    //#endregion src/v8/boolean.ts

    //#region src/v8/date.ts
    /**
     * @__deps $emnapiCtx
     * @__sig ppd
     */
    function _v8_date_new(context, value) {
        return emnapiCtx.napiValueFromJsValue(new Date(value));
    }

    //#endregion src/v8/date.ts

    //#region src/v8/exception.ts
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_exception_error(message, options) {
        return emnapiCtx.napiValueFromJsValue(new Error(emnapiCtx.jsValueFromNapiValue(message), 
        // @ts-ignore
        emnapiCtx.jsValueFromNapiValue(options)));
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_exception_type_error(message, options) {
        return emnapiCtx.napiValueFromJsValue(new TypeError(emnapiCtx.jsValueFromNapiValue(message), 
        // @ts-ignore
        emnapiCtx.jsValueFromNapiValue(options)));
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_exception_range_error(message, options) {
        return emnapiCtx.napiValueFromJsValue(new RangeError(emnapiCtx.jsValueFromNapiValue(message), 
        // @ts-ignore
        emnapiCtx.jsValueFromNapiValue(options)));
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_exception_reference_error(message, options) {
        return emnapiCtx.napiValueFromJsValue(new ReferenceError(emnapiCtx.jsValueFromNapiValue(message), 
        // @ts-ignore
        emnapiCtx.jsValueFromNapiValue(options)));
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_exception_syntax_error(message, options) {
        return emnapiCtx.napiValueFromJsValue(new SyntaxError(emnapiCtx.jsValueFromNapiValue(message), 
        // @ts-ignore
        emnapiCtx.jsValueFromNapiValue(options)));
    }

    //#endregion src/v8/exception.ts

    //#region src/v8/external.ts
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_external_new(isolate, data) {
        const external = emnapiCtx.isolate.createExternal(data);
        return emnapiCtx.napiValueFromJsValue(external);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_external_value(external) {
        const obj = emnapiCtx.jsValueFromNapiValue(external);
        return emnapiCtx.isolate.getExternalValue(obj);
    }

    //#endregion src/v8/external.ts

    //#region src/v8/function.ts
    /**
     * @__deps $emnapiCtx
     * @__sig vpp
     */
    function _v8_function_set_name(fn, name) {
        if (!emnapiCtx.features.setFunctionName) {
            return;
        }
        const str = emnapiCtx.jsValueFromNapiValue(name);
        const func = emnapiCtx.jsValueFromNapiValue(fn);
        emnapiCtx.features.setFunctionName(func, str);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pppip
     */
    function _v8_function_new_instance(fn, ctx, argc, argv) {
        if (emnapiCtx.isolate.hasPendingException())
            return 1;
        const Ctor = emnapiCtx.jsValueFromNapiValue(fn);
        argv >>>= 0;
        let i;
        let ret;
        try {
            var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
            if (emnapiCtx.features.Reflect) {
                const argList = Array(argc);
                for (i = 0; i < argc; i++) {
                    const argVal = GET_HEAP_DATA_VIEW().getUint32(argv + i * 4, true);
                    argList[i] = emnapiCtx.jsValueFromNapiValue(argVal);
                }
                ret = emnapiCtx.features.Reflect.construct(Ctor, argList, Ctor);
            }
            else {
                const args = Array(argc + 1);
                args[0] = undefined;
                for (i = 0; i < argc; i++) {
                    const argVal = GET_HEAP_DATA_VIEW().getUint32(argv + i * 4, true);
                    args[i + 1] = emnapiCtx.jsValueFromNapiValue(argVal);
                }
                const BoundCtor = Ctor.bind.apply(Ctor, args);
                ret = new BoundCtor();
            }
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
        return emnapiCtx.napiValueFromJsValue(ret);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppppip
     */
    function _v8_function_call(fn, ctx, recv, argc, argv) {
        if (emnapiCtx.isolate.hasPendingException())
            return 1;
        const func = emnapiCtx.jsValueFromNapiValue(fn);
        const thisArg = emnapiCtx.jsValueFromNapiValue(recv);
        argv >>>= 0;
        let i;
        let ret;
        try {
            const argList = Array(argc);
            var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
            for (i = 0; i < argc; i++) {
                const argVal = GET_HEAP_DATA_VIEW().getUint32(argv + i * 4, true);
                argList[i] = emnapiCtx.jsValueFromNapiValue(argVal);
            }
            ret = func.apply(thisArg, argList);
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
        return emnapiCtx.napiValueFromJsValue(ret);
    }

    //#endregion src/v8/function.ts

    //#region src/v8/handle_scope.ts
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_open_handle_scope(_isolate) {
        return emnapiCtx.isolate.openScope().id;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig v
     */
    function _v8_close_handle_scope() {
        return emnapiCtx.isolate.closeScope();
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_handle_scope_escape(scope, value) {
        const scopeValue = emnapiCtx.getHandleScope(scope);
        value >>>= 0;
        return scopeValue.escape(value);
    }

    //#endregion src/v8/handle_scope.ts

    //#region src/v8/internal.ts
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_global_value_identity(value) {
        return emnapiCtx.isolate.acquireGlobalValueIdentity(emnapiCtx.jsValueFromNapiValue(value));
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vp
     */
    function _v8_retain_global_value_identity(identity) {
        emnapiCtx.isolate.retainGlobalValueIdentity(identity);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vp
     */
    function _v8_release_global_value_identity(identity) {
        emnapiCtx.isolate.releaseGlobalValueIdentity(identity);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_local_from_global_reference(ref) {
        const reference = emnapiCtx.isolate.getRef(ref);
        if (reference === undefined)
            return 1;
        const id = reference.slot();
        return id || 1;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_globalize_reference(isolate, value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        if (jsValue === undefined)
            return 0;
        return emnapiCtx.isolate.createReference(jsValue).id;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ipp
     */
    function _v8_global_reference_equals(lhs, rhs) {
        const left = emnapiCtx.isolate.getRef(lhs);
        const right = emnapiCtx.isolate.getRef(rhs);
        if (!left || !right)
            return 0;
        return left.getSlot()?.deref() === right.getSlot()?.deref() ? 1 : 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_copy_global_reference(from) {
        const ref = emnapiCtx.isolate.getRef(from);
        if (ref === undefined)
            return 0;
        return ref.copy().id;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vpp
     */
    function _v8_move_global_reference(from, to) {
        const refFrom = emnapiCtx.isolate.getRef(from);
        const refTo = emnapiCtx.isolate.getRef(to);
        if (refFrom === undefined || refTo === undefined)
            return;
        refFrom.move(refTo);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vp
     */
    function _v8_dispose_global(ref) {
        emnapiCtx.isolate.removeRef(ref);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vppppi
     */
    function _v8_make_weak(ref, data, callback, weak_callback, type) {
        const refValue = emnapiCtx.isolate.getRef(ref);
        if (!refValue)
            return;
        callback >>>= 0;
        let field0 = 0;
        let field1 = 0;
        if (type === 1) {
            const value = refValue.deref();
            if (value !== undefined) {
                field0 = emnapiCtx.isolate.getInternalField(value, 0) ?? 0;
                field1 = emnapiCtx.isolate.getInternalField(value, 1) ?? 0;
                if ((typeof field0 !== 'number' && typeof field0 !== 'bigint') ||
                    (typeof field1 !== 'number' && typeof field1 !== 'bigint')) {
                    throw new Error('Internal field is not a number');
                }
            }
        }
        refValue.setWeak(data, (data) => {
            (emnapiPluginCtx.wasmTable.get(callback))(weak_callback, data, type, field0, field1);
        });
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_is_weak(ref) {
        const refValue = emnapiCtx.isolate.getRef(ref);
        if (!refValue || typeof WeakRef !== 'function')
            return 0;
        return refValue.getSlot() instanceof WeakRef ? 1 : 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_clear_weak(ref) {
        const refValue = emnapiCtx.isolate.getRef(ref);
        if (!refValue)
            return 0;
        refValue.clearWeak();
        return 0;
    }

    //#endregion src/v8/internal.ts

    //#region src/v8/isolate.ts
    /**
     * @__sig p
     */
    function _v8_isolate_get_current_context() {
        return 6 /* Constant.GLOBAL */;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_context_global(_context) {
        return emnapiCtx.napiValueFromJsValue(globalThis);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_isolate_throw_exception(error) {
        emnapiCtx.isolate.throwException(emnapiCtx.jsValueFromNapiValue(error));
        return error;
    }

    //#endregion src/v8/isolate.ts

    //#region src/v8/json.ts
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_json_parse(context, json_string) {
        const jsonStringValue = emnapiCtx.jsValueFromNapiValue(json_string);
        try {
            const parsedValue = JSON.parse(jsonStringValue);
            return emnapiCtx.napiValueFromJsValue(parsedValue);
        }
        catch (e) {
            emnapiCtx.isolate.throwException(e);
            return 0;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pppp
     */
    function _v8_json_stringify(context, json_object, gap) {
        const jsonStringValue = emnapiCtx.jsValueFromNapiValue(json_object);
        try {
            const str = JSON.stringify(jsonStringValue, null, emnapiCtx.jsValueFromNapiValue(gap));
            return emnapiCtx.napiValueFromJsValue(str);
        }
        catch (e) {
            emnapiCtx.isolate.throwException(e);
            return 0;
        }
    }

    //#endregion src/v8/json.ts

    //#region src/v8/number.ts
    /**
     * @__deps $emnapiCtx
     * @__sig dp
     */
    function _v8_number_value(value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        return Number(jsValue);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vpp
     */
    function _v8_integer_value(value, out) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        // Use BigInt if available, else fallback to Number
        let v;
        if (typeof jsValue === 'bigint') {
            v = jsValue;
        }
        else {
            v = Math.trunc(Number(jsValue));
        }
        out >>>= 0;
        var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
        GET_HEAP_DATA_VIEW().setBigInt64(out, BigInt(v), true);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_uint32_value(value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        return Number(jsValue) >>> 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_int32_value(value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        return Number(jsValue) | 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppd
     */
    function _v8_number_new(isolate, value) {
        return emnapiCtx.napiValueFromJsValue(value);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppi
     */
    function _v8_integer_new(isolate, value) {
        return emnapiCtx.napiValueFromJsValue(value | 0);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppi
     */
    function _v8_integer_new_from_unsigned(isolate, value) {
        return emnapiCtx.napiValueFromJsValue(value >>> 0);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppd
     */
    function _v8_number_object_new(isolate, value) {
        // eslint-disable-next-line no-new-wrappers
        return emnapiCtx.napiValueFromJsValue(new Number(value));
    }

    //#endregion src/v8/number.ts

    //#region src/v8/object.ts
    /**
     * @__deps $emnapiCtx
     * @__sig ippppp
     */
    function _v8_object_set(obj, context, key, value, success) {
        let r = false;
        try {
            r = Reflect.set(emnapiCtx.jsValueFromNapiValue(obj), emnapiCtx.jsValueFromNapiValue(key), emnapiCtx.jsValueFromNapiValue(value));
        }
        catch (_) {
            return 10;
        }
        success >>>= 0;
        if (success) {
            const v = r ? 1 : 0;
            var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
            GET_HEAP_DATA_VIEW().setInt32(success, v, true);
        }
        return 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ippipp
     */
    function _v8_object_set_index(obj, _context, index, value, success) {
        let r = false;
        try {
            r = Reflect.set(emnapiCtx.jsValueFromNapiValue(obj), index >>> 0, emnapiCtx.jsValueFromNapiValue(value));
        }
        catch (_) {
            return 10;
        }
        success >>>= 0;
        if (success) {
            const v = r ? 1 : 0;
            var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
            GET_HEAP_DATA_VIEW().setInt32(success, v, true);
        }
        return 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ippppip
     */
    function _v8_object_define_own_property(obj, _context, key, value, attributes, success) {
        obj >>>= 0;
        key >>>= 0;
        value >>>= 0;
        success >>>= 0;
        try {
            const target = emnapiCtx.jsValueFromNapiValue(obj);
            const propertyKey = emnapiCtx.jsValueFromNapiValue(key);
            const propertyValue = emnapiCtx.jsValueFromNapiValue(value);
            const result = Reflect.defineProperty(target, propertyKey, {
                value: propertyValue,
                writable: (attributes & 1) === 0,
                enumerable: (attributes & 2) === 0,
                configurable: (attributes & 4) === 0
            });
            const successValue = result ? 1 : 0;
            if (success) {
                var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
                GET_HEAP_DATA_VIEW().setInt32(success, successValue, true);
            }
            return 0;
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ipppp
     */
    function _v8_object_get_property_attributes(obj, _context, key, attributes) {
        obj >>>= 0;
        key >>>= 0;
        attributes >>>= 0;
        try {
            const target = emnapiCtx.jsValueFromNapiValue(obj);
            const propertyKey = emnapiCtx.jsValueFromNapiValue(key);
            let current = target;
            let descriptor;
            while (current !== null) {
                descriptor = Object.getOwnPropertyDescriptor(current, propertyKey);
                if (descriptor)
                    break;
                current = Object.getPrototypeOf(current);
            }
            let result = 0;
            if (descriptor) {
                const readonly = 'writable' in descriptor ? descriptor.writable === false : descriptor.set == null;
                if (readonly)
                    result |= 1;
                if (descriptor.enumerable === false)
                    result |= 2;
                if (descriptor.configurable === false)
                    result |= 4;
            }
            attributes >>>= 0;
            if (attributes) {
                var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
                GET_HEAP_DATA_VIEW().setInt32(attributes, result, true);
            }
            return 0;
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ipppp
     */
    function _v8_object_has(obj, _context, key, result) {
        obj >>>= 0;
        key >>>= 0;
        result >>>= 0;
        try {
            const has = Reflect.has(emnapiCtx.jsValueFromNapiValue(obj), emnapiCtx.jsValueFromNapiValue(key));
            const hasValue = has ? 1 : 0;
            if (result) {
                var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
                GET_HEAP_DATA_VIEW().setInt32(result, hasValue, true);
            }
            return 0;
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ippip
     */
    function _v8_object_has_index(obj, _context, index, result) {
        obj >>>= 0;
        result >>>= 0;
        try {
            const has = Reflect.has(emnapiCtx.jsValueFromNapiValue(obj), index >>> 0);
            const hasValue = has ? 1 : 0;
            if (result) {
                var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
                GET_HEAP_DATA_VIEW().setInt32(result, hasValue, true);
            }
            return 0;
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ipppp
     */
    function _v8_object_delete(obj, _context, key, result) {
        obj >>>= 0;
        key >>>= 0;
        result >>>= 0;
        try {
            const deleted = Reflect.deleteProperty(emnapiCtx.jsValueFromNapiValue(obj), emnapiCtx.jsValueFromNapiValue(key));
            const deletedValue = deleted ? 1 : 0;
            if (result) {
                var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
                GET_HEAP_DATA_VIEW().setInt32(result, deletedValue, true);
            }
            return 0;
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ippip
     */
    function _v8_object_delete_index(obj, _context, index, result) {
        obj >>>= 0;
        result >>>= 0;
        try {
            const deleted = Reflect.deleteProperty(emnapiCtx.jsValueFromNapiValue(obj), String(index >>> 0));
            const deletedValue = deleted ? 1 : 0;
            if (result) {
                var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
                GET_HEAP_DATA_VIEW().setInt32(result, deletedValue, true);
            }
            return 0;
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_object_get_property_names(obj, _context) {
        obj >>>= 0;
        try {
            const names = [];
            let current = emnapiCtx.jsValueFromNapiValue(obj);
            while (current !== null) {
                for (const propertyKey of Reflect.ownKeys(current)) {
                    const descriptor = Object.getOwnPropertyDescriptor(current, propertyKey);
                    if (descriptor?.enumerable && names.indexOf(propertyKey) === -1)
                        names.push(propertyKey);
                }
                current = Object.getPrototypeOf(current);
            }
            return emnapiCtx.napiValueFromJsValue(names);
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 0;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_object_get_own_property_names(obj, _context) {
        obj >>>= 0;
        try {
            const names = [];
            const current = emnapiCtx.jsValueFromNapiValue(obj);
            for (const propertyKey of Reflect.ownKeys(current)) {
                if (names.indexOf(propertyKey) === -1)
                    names.push(propertyKey);
            }
            return emnapiCtx.napiValueFromJsValue(names);
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 0;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ipppp
     */
    function _v8_object_set_prototype(obj, _context, prototype, result) {
        obj >>>= 0;
        prototype >>>= 0;
        result >>>= 0;
        try {
            const changed = Reflect.setPrototypeOf(emnapiCtx.jsValueFromNapiValue(obj), emnapiCtx.jsValueFromNapiValue(prototype));
            const changedValue = changed ? 1 : 0;
            if (result) {
                var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
                GET_HEAP_DATA_VIEW().setInt32(result, changedValue, true);
            }
            return 0;
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ipppp
     */
    function _v8_object_has_own_property(obj, _context, key, result) {
        obj >>>= 0;
        key >>>= 0;
        result >>>= 0;
        try {
            const has = Object.prototype.hasOwnProperty.call(emnapiCtx.jsValueFromNapiValue(obj), emnapiCtx.jsValueFromNapiValue(key));
            const hasValue = has ? 1 : 0;
            if (result) {
                var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
                GET_HEAP_DATA_VIEW().setInt32(result, hasValue, true);
            }
            return 0;
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppppip
     */
    function _v8_object_call_as_function(obj, _context, receiver, argc, argv) {
        obj >>>= 0;
        receiver >>>= 0;
        argv >>>= 0;
        try {
            const argList = Array(argc);
            var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
            for (let i = 0; i < argc; i++) {
                const argValue = GET_HEAP_DATA_VIEW().getUint32(argv + i * 4, true);
                argList[i] = emnapiCtx.jsValueFromNapiValue(argValue);
            }
            const result = Reflect.apply(emnapiCtx.jsValueFromNapiValue(obj), emnapiCtx.jsValueFromNapiValue(receiver), argList);
            return emnapiCtx.napiValueFromJsValue(result);
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 0;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pppip
     */
    function _v8_object_call_as_constructor(obj, _context, argc, argv) {
        obj >>>= 0;
        argv >>>= 0;
        try {
            const argList = Array(argc);
            var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
            for (let i = 0; i < argc; i++) {
                const argValue = GET_HEAP_DATA_VIEW().getUint32(argv + i * 4, true);
                argList[i] = emnapiCtx.jsValueFromNapiValue(argValue);
            }
            const constructor = emnapiCtx.jsValueFromNapiValue(obj);
            return emnapiCtx.napiValueFromJsValue(Reflect.construct(constructor, argList, constructor));
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 0;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ippppppppiiip
     */
    function _v8_object_set_native_data_property(obj, _context, name, getter_wrap, setter_wrap, getter, setter, data, attribute, getter_side_effect_type, setter_side_effect_type, success) {
        if (emnapiCtx.isolate.hasPendingException())
            return 1;
        getter_wrap >>>= 0;
        setter_wrap >>>= 0;
        const getterWrap = getter_wrap ? (emnapiPluginCtx.wasmTable.get(getter_wrap)) : undefined;
        const setterWrap = setter_wrap ? (emnapiPluginCtx.wasmTable.get(setter_wrap)) : undefined;
        try {
            const objectTemplate = emnapiCtx.isolate.createObjectTemplate(undefined);
            const nameValue = emnapiCtx.jsValueFromNapiValue(name);
            if (nameValue == null)
                return 1;
            objectTemplate.setNativeDataPropertyOnInstance(emnapiCtx.jsValueFromNapiValue(obj), nameValue, getterWrap, setterWrap, getter, setter, emnapiCtx.jsValueFromNapiValue(data), attribute, getter_side_effect_type, setter_side_effect_type);
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
        success >>>= 0;
        if (success) {
            var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
            GET_HEAP_DATA_VIEW().setInt32(success, 1, true);
        }
        return 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_object_internal_field_count(obj) {
        const objValue = emnapiCtx.jsValueFromNapiValue(obj);
        return emnapiCtx.isolate.getInternalFieldCount(objValue);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vpip
     */
    function _v8_object_set_internal_field(obj, index, data) {
        const objValue = emnapiCtx.jsValueFromNapiValue(obj);
        const dataValue = emnapiCtx.jsValueFromNapiValue(data);
        emnapiCtx.isolate.setInternalField(objValue, index, dataValue);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vpip
     */
    function _v8_object_set_aligned_pointer_in_internal_field(obj, index, data) {
        const objValue = emnapiCtx.jsValueFromNapiValue(obj);
        emnapiCtx.isolate.setInternalField(objValue, index, data);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppi
     */
    function _v8_object_get_internal_field(obj, index) {
        const objValue = emnapiCtx.jsValueFromNapiValue(obj);
        const value = emnapiCtx.isolate.getInternalField(objValue, index);
        return emnapiCtx.isolate.napiValueFromJsValue(value);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppi
     */
    function _v8_object_get_aligned_pointer_in_internal_field(obj, index) {
        const objValue = emnapiCtx.jsValueFromNapiValue(obj);
        const value = emnapiCtx.isolate.getInternalField(objValue, index);
        return value;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pppp
     */
    function _v8_object_get_key(obj, context, key) {
        const objValue = emnapiCtx.jsValueFromNapiValue(obj);
        if (!objValue)
            return 1;
        return emnapiCtx.napiValueFromJsValue(objValue[emnapiCtx.jsValueFromNapiValue(key)]);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pppi
     */
    function _v8_object_get_index(obj, context, index) {
        const objValue = emnapiCtx.jsValueFromNapiValue(obj);
        if (!objValue)
            return 1;
        return emnapiCtx.napiValueFromJsValue(objValue[index >>> 0]);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_private_for_api(isolate, name) {
        const n = emnapiCtx.isolate.getOrCreateGlobalPrivate(emnapiCtx.jsValueFromNapiValue(name));
        return emnapiCtx.napiValueFromJsValue(n);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ippppp
     */
    function _v8_object_set_private(obj, context, key, value, success) {
        if (emnapiCtx.isolate.hasPendingException())
            return 1;
        const o = emnapiCtx.jsValueFromNapiValue(obj);
        const k = emnapiCtx.jsValueFromNapiValue(key);
        const v = emnapiCtx.jsValueFromNapiValue(value);
        try {
            emnapiCtx.isolate.setPrivate(o, k, v);
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
        success >>>= 0;
        if (success) {
            const vv = 1;
            var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
            GET_HEAP_DATA_VIEW().setInt32(success, vv, true);
        }
        return 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ipppp
     */
    function _v8_object_has_private(obj, context, key, has) {
        if (emnapiCtx.isolate.hasPendingException())
            return 1;
        const o = emnapiCtx.jsValueFromNapiValue(obj);
        const k = emnapiCtx.jsValueFromNapiValue(key);
        let v;
        try {
            v = emnapiCtx.isolate.hasPrivate(o, k) ? 1 : 0;
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
        has >>>= 0;
        if (has) {
            var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
            GET_HEAP_DATA_VIEW().setInt32(has, v, true);
        }
        return 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pppp
     */
    function _v8_object_get_private(obj, context, key) {
        if (emnapiCtx.isolate.hasPendingException())
            return 1;
        const o = emnapiCtx.jsValueFromNapiValue(obj);
        const k = emnapiCtx.jsValueFromNapiValue(key);
        try {
            const v = emnapiCtx.isolate.getPrivate(o, k);
            return emnapiCtx.napiValueFromJsValue(v);
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ipppp
     */
    function _v8_object_delete_private(obj, context, key, success) {
        if (emnapiCtx.isolate.hasPendingException())
            return 1;
        const o = emnapiCtx.jsValueFromNapiValue(obj);
        const k = emnapiCtx.jsValueFromNapiValue(key);
        let r;
        try {
            r = emnapiCtx.isolate.deletePrivate(o, k);
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
        success >>>= 0;
        if (success) {
            const vv = r ? 1 : 0;
            var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
            GET_HEAP_DATA_VIEW().setInt32(success, vv, true);
        }
        return 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_object_new(isolate) {
        return emnapiCtx.napiValueFromJsValue({});
    }

    //#endregion src/v8/object.ts

    //#region src/v8/script.ts
    /**
     * @__deps $emnapiCtx
     * @__sig pppii
     */
    function _v8_script_compiler_compile_unbound_script(isolate, sourceString, options, reason) {
        const str = emnapiCtx.jsValueFromNapiValue(sourceString);
        if (!str)
            return 1;
        return emnapiCtx.napiValueFromJsValue(str);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_unbound_script_bind_to_current_context(unboundScript) {
        const str = emnapiCtx.jsValueFromNapiValue(unboundScript);
        if (!str)
            return 1;
        return emnapiCtx.napiValueFromJsValue(str);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_script_run(script, context) {
        if (emnapiCtx.isolate.hasPendingException())
            return 1;
        const str = emnapiCtx.jsValueFromNapiValue(script);
        const g = emnapiCtx.jsValueFromNapiValue(context);
        let ret;
        try {
            ret = g.eval(str);
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
        return emnapiCtx.napiValueFromJsValue(ret);
    }

    //#endregion src/v8/script.ts

    //#region src/v8/string.ts
    /**
     * @__deps $emnapiCtx
     * @__deps $emnapiString
     * @__sig pppii
     */
    function _v8_string_new_from_utf8(isolate, data, type, length) {
        data >>>= 0;
        length >>>= 0;
        const str = emnapiString.UTF8ToString(data, length);
        return emnapiCtx.napiValueFromJsValue(str);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_string_object_new(isolate, value) {
        // eslint-disable-next-line no-new-wrappers
        return emnapiCtx.napiValueFromJsValue(new String(emnapiCtx.jsValueFromNapiValue(value)));
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_string_object_value_of(self) {
        const strObj = emnapiCtx.jsValueFromNapiValue(self);
        return emnapiCtx.napiValueFromJsValue(strObj.valueOf());
    }
    /**
     * @__deps $emnapiCtx
     * @__deps $emnapiString
     * @__sig pppii
     */
    function _v8_string_new_from_one_byte(isolate, data, type, length) {
        data >>>= 0;
        length >>>= 0;
        const str = emnapiString.encode(data, length === -1 || length === 4294967295, length >>> 0, (c) => String.fromCharCode(c));
        return emnapiCtx.napiValueFromJsValue(str);
    }
    /**
     * @__deps $emnapiCtx
     * @__deps $emnapiString
     * @__sig pppii
     */
    function _v8_string_new_from_two_byte(isolate, data, type, length) {
        data >>>= 0;
        length >>>= 0;
        const str = emnapiString.UTF16ToString(data, length);
        return emnapiCtx.napiValueFromJsValue(str);
    }
    /**
     * @__deps $emnapiCtx
     * @__deps $emnapiString
     * @__sig pppi
     */
    function _v8_string_new_external_one_byte(isolate, data, length) {
        data >>>= 0;
        length >>>= 0;
        const str = emnapiString.encode(data, length === -1 || length === 4294967295, length >>> 0, (c) => String.fromCharCode(c));
        return emnapiCtx.napiValueFromJsValue(str);
    }
    /**
     * @__deps $emnapiCtx
     * @__deps $emnapiString
     * @__sig pppi
     */
    function _v8_string_new_external_two_byte(isolate, data, length) {
        data >>>= 0;
        length >>>= 0;
        const str = emnapiString.UTF16ToString(data, length);
        return emnapiCtx.napiValueFromJsValue(str);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pppi
     */
    function _v8_regex_new(context, pattern, flags) {
        pattern >>>= 0;
        const str = emnapiCtx.jsValueFromNapiValue(pattern);
        let f = '';
        if (flags & 1)
            f += 'g';
        if (flags & 2)
            f += 'i';
        if (flags & 4)
            f += 'm';
        if (flags & 8)
            f += 'y';
        if (flags & 16)
            f += 'u';
        if (flags & 32)
            f += 's';
        return emnapiCtx.napiValueFromJsValue(f ? new RegExp(str, f) : new RegExp(str));
    }
    /**
     * @__deps $emnapiCtx
     * @__deps $emnapiString
     * @__sig ipp
     */
    function _v8_string_utf8_length(str, isolate) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(str);
        if (jsValue === undefined)
            return 0;
        if (typeof jsValue !== 'string')
            return 0;
        return emnapiString.lengthBytesUTF8(jsValue);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_string_length(str) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(str);
        if (jsValue === undefined)
            return 0;
        if (typeof jsValue !== 'string')
            return 0;
        return jsValue.length;
    }
    /**
     * @__deps $emnapiCtx
     * @__deps $emnapiString
     * @__sig ipppipi
     */
    function _v8_string_write_utf8(str, isolate, buffer, length, nchars_ref, options) {
        buffer >>>= 0;
        nchars_ref >>>= 0;
        const jsValue = emnapiCtx.jsValueFromNapiValue(str);
        var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
        if (jsValue === undefined || typeof jsValue !== 'string') {
            if (nchars_ref) {
                GET_HEAP_DATA_VIEW().setInt32(nchars_ref, 0, true);
            }
            return 0;
        }
        const written = emnapiString.stringToUTF8(jsValue, buffer, length);
        if (nchars_ref) {
            GET_HEAP_DATA_VIEW().setInt32(nchars_ref, written, true);
        }
        return written;
    }

    //#endregion src/v8/string.ts

    //#region src/v8/template.ts
    /**
     * @__deps $emnapiCtx
     * @__sig ippppp
     */
    function _v8_get_cb_info(cbinfo, argc, argv, this_arg, data) {
        if (!cbinfo)
            return 1;
        const cbinfoValue = emnapiCtx.getCallbackInfo(cbinfo);
        argc >>>= 0;
        argv >>>= 0;
        var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
        if (argv) {
            if (!argc)
                return 1;
            let argcValue = GET_HEAP_DATA_VIEW().getUint32(argc, true);
            argcValue >>>= 0;
            const len = cbinfoValue.args.length;
            const arrlen = argcValue < len ? argcValue : len;
            let i = 0;
            for (; i < arrlen; i++) {
                const argVal = emnapiCtx.napiValueFromJsValue(cbinfoValue.args[i]);
                GET_HEAP_DATA_VIEW().setUint32(argv + i * 4, argVal, true);
            }
            if (i < argcValue) {
                for (; i < argcValue; i++) {
                    GET_HEAP_DATA_VIEW().setUint32(argv + i * 4, 1, true);
                }
            }
        }
        if (argc) {
            GET_HEAP_DATA_VIEW().setUint32(argc, cbinfoValue.args.length, true);
        }
        if (this_arg) {
            this_arg >>>= 0;
            const v = emnapiCtx.napiValueFromJsValue(cbinfoValue.thiz);
            GET_HEAP_DATA_VIEW().setUint32(this_arg, v, true);
        }
        if (data) {
            data >>>= 0;
            const localData = emnapiCtx.napiValueFromJsValue(cbinfoValue.data);
            GET_HEAP_DATA_VIEW().setUint32(data, localData, true);
        }
        return 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppppppiiipiii
     */
    function _v8_function_template_new(isolate, callback, cb, data, signature, length, behavior, side_effect_type, c_function, instance_type, allowed_receiver_instance_type_range_start, allowed_receiver_instance_type_range_end) {
        const jsCb = (emnapiPluginCtx.wasmTable.get(callback));
        const tpl = emnapiCtx.isolate.createFunctionTemplate(jsCb, cb, emnapiCtx.jsValueFromNapiValue(data), emnapiCtx.jsValueFromNapiValue(signature));
        return emnapiCtx.napiValueFromJsValue(tpl);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pppppiii
     */
    function _v8_function_new(context, callback, cb, data, length, behavior, side_effect_type) {
        const jsCb = (emnapiPluginCtx.wasmTable.get(callback));
        const tpl = emnapiCtx.isolate.createFunctionTemplate(jsCb, cb, emnapiCtx.jsValueFromNapiValue(data), undefined);
        const func = tpl.getFunction();
        return emnapiCtx.napiValueFromJsValue(func);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_cbinfo_holder(info) {
        const cbinfoValue = emnapiCtx.getCallbackInfo(info);
        const { holder } = cbinfoValue;
        return emnapiCtx.napiValueFromJsValue(holder);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_cbinfo_new_target(info) {
        const cbinfoValue = emnapiCtx.getCallbackInfo(info);
        const { thiz, fn } = cbinfoValue;
        return thiz == null || typeof fn !== 'function'
            ? 0
            : thiz instanceof fn
                ? emnapiCtx.napiValueFromJsValue(fn)
                : 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_function_template_get_function(template, context) {
        const tpl = emnapiCtx.jsValueFromNapiValue(template);
        if (!tpl)
            return 0;
        return emnapiCtx.napiValueFromJsValue(tpl.getFunction());
    }
    function _v8_function_template_set_class_name(template, name) {
        const tpl = emnapiCtx.jsValueFromNapiValue(template);
        const nameValue = emnapiCtx.jsValueFromNapiValue(name);
        if (!tpl || nameValue == null)
            return;
        tpl.setClassName(nameValue);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vpppp
     */
    function _v8_function_template_set_call_handler(template, callback_wrap, callback, data) {
        const tpl = emnapiCtx.jsValueFromNapiValue(template);
        if (!tpl)
            return;
        callback_wrap >>>= 0;
        const callbackWrap = (emnapiPluginCtx.wasmTable.get(callback_wrap));
        tpl.setCallHandler({
            callbackWrap,
            callback,
            data: emnapiCtx.jsValueFromNapiValue(data)
        });
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_object_template_new(isolate, constructor) {
        const tpl = emnapiCtx.isolate.createObjectTemplate(emnapiCtx.jsValueFromNapiValue(constructor));
        return emnapiCtx.napiValueFromJsValue(tpl);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vpi
     */
    function _v8_object_template_set_internal_field_count(tpl, value) {
        const templateObject = emnapiCtx.jsValueFromNapiValue(tpl);
        templateObject.setInternalFieldCount(value);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vpppp
     */
    function _v8_object_template_set_call_as_function_handler(template, callback_wrap, callback, data) {
        const tpl = emnapiCtx.jsValueFromNapiValue(template);
        if (!tpl)
            return;
        callback_wrap >>>= 0;
        const callbackWrap = (emnapiPluginCtx.wasmTable.get(callback_wrap));
        tpl.setCallAsFunctionHandler({
            callbackWrap,
            callback,
            data: emnapiCtx.jsValueFromNapiValue(data)
        });
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_object_template_new_instance(obj_tpl, context) {
        if (emnapiCtx.isolate.hasPendingException())
            return 1;
        const objTemplate = emnapiCtx.jsValueFromNapiValue(obj_tpl);
        return emnapiCtx.napiValueFromJsValue(objTemplate.newInstance(context));
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_signature_new(isolate, receiver) {
        const rcv = emnapiCtx.jsValueFromNapiValue(receiver);
        const sig = emnapiCtx.isolate.createSignature(rcv);
        return emnapiCtx.napiValueFromJsValue(sig);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vpppi
     */
    function _v8_template_set(tpl, name, value, attr) {
        const templateObject = emnapiCtx.jsValueFromNapiValue(tpl);
        if (!templateObject)
            return;
        const nameValue = emnapiCtx.jsValueFromNapiValue(name);
        const valueValue = emnapiCtx.jsValueFromNapiValue(value);
        if (nameValue == null)
            return;
        templateObject.set(nameValue, valueValue, attr);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_function_template_instance_template(tpl) {
        const templateObject = emnapiCtx.jsValueFromNapiValue(tpl);
        if (!templateObject)
            return 1;
        return emnapiCtx.napiValueFromJsValue(templateObject.instanceTemplate());
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_function_template_prototype_template(tpl) {
        const templateObject = emnapiCtx.jsValueFromNapiValue(tpl);
        if (!templateObject)
            return 1;
        return emnapiCtx.napiValueFromJsValue(templateObject.prototypeTemplate());
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vpp
     */
    function _v8_get_property_cb_info(cbinfo, args) {
        if (!cbinfo)
            return;
        const cbinfoValue = emnapiCtx.getCallbackInfo(cbinfo);
        args >>>= 0;
        const thiz = emnapiCtx.napiValueFromJsValue(cbinfoValue.thiz);
        const holder = emnapiCtx.napiValueFromJsValue(cbinfoValue.holder);
        var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
        GET_HEAP_DATA_VIEW().setUint32(args + 2 * 4, holder, true);
        GET_HEAP_DATA_VIEW().setUint32(args + 7 * 4, thiz, true);
        const localData = emnapiCtx.napiValueFromJsValue(cbinfoValue.data);
        GET_HEAP_DATA_VIEW().setUint32(args + 6 * 4, localData, true);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vppppppppppppi
     */
    function _v8_object_template_set_named_property_handler(tpl, getter_wrap, setter_wrap, query_wrap, deleter_wrap, enumerator_wrap, getter, setter, query, deleter, enumerator, data, flags) {
        const templateObject = emnapiCtx.jsValueFromNapiValue(tpl);
        if (!templateObject)
            return;
        getter_wrap >>>= 0;
        setter_wrap >>>= 0;
        query_wrap >>>= 0;
        deleter_wrap >>>= 0;
        enumerator_wrap >>>= 0;
        const getterWrap = getter_wrap ? (emnapiPluginCtx.wasmTable.get(getter_wrap)) : undefined;
        const setterWrap = setter_wrap ? (emnapiPluginCtx.wasmTable.get(setter_wrap)) : undefined;
        const queryWrap = query_wrap ? (emnapiPluginCtx.wasmTable.get(query_wrap)) : undefined;
        const deleterWrap = deleter_wrap ? (emnapiPluginCtx.wasmTable.get(deleter_wrap)) : undefined;
        const enumeratorWrap = enumerator_wrap ? (emnapiPluginCtx.wasmTable.get(enumerator_wrap)) : undefined;
        templateObject.setNamedPropertyHandler({
            getterWrap,
            setterWrap,
            queryWrap,
            deleterWrap,
            enumeratorWrap,
            getter,
            setter,
            query,
            deleter,
            enumerator,
            data: emnapiCtx.jsValueFromNapiValue(data),
            flags
        });
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vppppppppppppi
     */
    function _v8_object_template_set_indexed_property_handler(tpl, getter_wrap, setter_wrap, query_wrap, deleter_wrap, enumerator_wrap, getter, setter, query, deleter, enumerator, data, flags) {
        const templateObject = emnapiCtx.jsValueFromNapiValue(tpl);
        if (!templateObject)
            return;
        getter_wrap >>>= 0;
        setter_wrap >>>= 0;
        query_wrap >>>= 0;
        deleter_wrap >>>= 0;
        enumerator_wrap >>>= 0;
        const getterWrap = getter_wrap ? (emnapiPluginCtx.wasmTable.get(getter_wrap)) : undefined;
        const setterWrap = setter_wrap ? (emnapiPluginCtx.wasmTable.get(setter_wrap)) : undefined;
        const queryWrap = query_wrap ? (emnapiPluginCtx.wasmTable.get(query_wrap)) : undefined;
        const deleterWrap = deleter_wrap ? (emnapiPluginCtx.wasmTable.get(deleter_wrap)) : undefined;
        const enumeratorWrap = enumerator_wrap ? (emnapiPluginCtx.wasmTable.get(enumerator_wrap)) : undefined;
        templateObject.setIndexedPropertyHandler({
            getterWrap,
            setterWrap,
            queryWrap,
            deleterWrap,
            enumeratorWrap,
            getter,
            setter,
            query,
            deleter,
            enumerator,
            data: emnapiCtx.jsValueFromNapiValue(data),
            flags
        });
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vpppppppiii
     */
    function _v8_object_template_set_native_data_property(tpl, name, getter_wrap, setter_wrap, getter, setter, data, attribute, getter_side_effect_type, setter_side_effect_type) {
        const templateObject = emnapiCtx.jsValueFromNapiValue(tpl);
        if (!templateObject)
            return;
        const nameValue = emnapiCtx.jsValueFromNapiValue(name);
        getter_wrap >>>= 0;
        setter_wrap >>>= 0;
        const getterWrap = (emnapiPluginCtx.wasmTable.get(getter_wrap));
        const setterWrap = (emnapiPluginCtx.wasmTable.get(setter_wrap));
        templateObject.setNativeDataProperty(nameValue, getterWrap, setterWrap, getter, setter, emnapiCtx.jsValueFromNapiValue(data), attribute, getter_side_effect_type, setter_side_effect_type);
    }

    //#endregion src/v8/template.ts

    //#region src/v8/try_catch.ts
    /**
     * @__deps $emnapiCtx
     * @__sig vp
     */
    function _v8_trycatch_construct(tc) {
        emnapiCtx.isolate.pushTryCatch(tc);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vp
     */
    function _v8_trycatch_destruct(tc) {
        emnapiCtx.isolate.popTryCatch(tc);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_trycatch_has_caught(tc) {
        const tryCatch = emnapiCtx.isolate.getTryCatch(tc);
        if (!tryCatch)
            return 0;
        return Number(tryCatch.hasCaught());
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_trycatch_rethrow(tc) {
        const tryCatch = emnapiCtx.isolate.getTryCatch(tc);
        if (!tryCatch)
            return 1;
        const e = tryCatch.rethrow(emnapiCtx.isolate);
        if (e === undefined)
            return 1;
        return emnapiCtx.napiValueFromJsValue(e);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _v8_trycatch_exception(tc) {
        const tryCatch = emnapiCtx.isolate.getTryCatch(tc);
        if (!tryCatch || !tryCatch.hasCaught())
            return 1;
        return emnapiCtx.napiValueFromJsValue(tryCatch.exception());
    }
    /**
     * @__deps $emnapiCtx
     * @__sig vp
     */
    function _v8_trycatch_reset(tc) {
        const tryCatch = emnapiCtx.isolate.getTryCatch(tc);
        if (!tryCatch)
            return;
        tryCatch.reset();
    }

    //#endregion src/v8/try_catch.ts

    //#region src/v8/value.ts
    /**
     * @__deps $emnapiCtx
     * @__sig ipp
     */
    function _v8_value_strict_equals(value, that) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        const jsThat = emnapiCtx.jsValueFromNapiValue(that);
        return Object.is(jsValue, jsThat) ? 1 : 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ipppp
     */
    function _v8_value_equals(value, _context, that, result) {
        value >>>= 0;
        that >>>= 0;
        result >>>= 0;
        try {
            const left = emnapiCtx.jsValueFromNapiValue(value);
            const right = emnapiCtx.jsValueFromNapiValue(that);
            // eslint-disable-next-line eqeqeq
            const equals = left == right;
            const equalsValue = equals ? 1 : 0;
            if (result) {
                var HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer), GET_HEAP_DATA_VIEW = () => HEAP_DATA_VIEW.buffer === emnapiPluginCtx.wasmMemory.buffer ? HEAP_DATA_VIEW : (HEAP_DATA_VIEW = new DataView(emnapiPluginCtx.wasmMemory.buffer));
                GET_HEAP_DATA_VIEW().setInt32(result, equalsValue, true);
            }
            return 0;
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return 1;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_value_to_boolean(value, isolate) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        const boolValue = Boolean(jsValue);
        return emnapiCtx.napiValueFromJsValue(boolValue);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_value_to_number(value, context) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        const numValue = Number(jsValue);
        return emnapiCtx.napiValueFromJsValue(numValue);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_value_to_string(value, context) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        const strValue = String(jsValue);
        return emnapiCtx.napiValueFromJsValue(strValue);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_value_to_object(value, context) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        if (jsValue === null || jsValue === undefined)
            return 0;
        const objValue = Object(jsValue);
        return emnapiCtx.napiValueFromJsValue(objValue);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_value_to_integer(value, context) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        const intValue = Math.trunc(Number(jsValue));
        return emnapiCtx.napiValueFromJsValue(intValue);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_value_to_uint32(value, context) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        const uint32Value = Number(jsValue) >>> 0;
        return emnapiCtx.napiValueFromJsValue(uint32Value);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_value_to_int32(value, context) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        const int32Value = Number(jsValue) | 0;
        return emnapiCtx.napiValueFromJsValue(int32Value);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ppp
     */
    function _v8_value_to_array_index(value, context) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        // V8: ToArrayIndex returns uint32 if possible, else undefined
        const n = Number(jsValue);
        if (typeof n === 'number' &&
            isFinite(n) &&
            n >= 0 &&
            n <= 0xffffffff &&
            Math.floor(n) === n) {
            return emnapiCtx.napiValueFromJsValue(n >>> 0);
        }
        return 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_value_is_function(value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        if (jsValue == null)
            return 0;
        const isFunction = typeof jsValue === 'function';
        return isFunction ? 1 : 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_value_is_number(value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        if (jsValue == null)
            return 0;
        const isFunction = typeof jsValue === 'number';
        return isFunction ? 1 : 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_value_is_array_buffer_view(value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        return ArrayBuffer.isView(jsValue) ? 1 : 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_value_is_object(value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        return jsValue !== null &&
            (typeof jsValue === 'object' || typeof jsValue === 'function')
            ? 1
            : 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_value_is_undefined(value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        const isUndefined = jsValue === undefined;
        return isUndefined ? 1 : 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_value_is_null(value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        const isUndefined = jsValue === null;
        return isUndefined ? 1 : 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_value_is_true(value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        if (jsValue == null)
            return 0;
        const isUndefined = jsValue === true;
        return isUndefined ? 1 : 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_value_is_false(value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        if (jsValue == null)
            return 0;
        const isUndefined = jsValue === false;
        return isUndefined ? 1 : 0;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig ip
     */
    function _v8_value_is_string(value) {
        const jsValue = emnapiCtx.jsValueFromNapiValue(value);
        if (jsValue == null)
            return 0;
        const isFunction = typeof jsValue === 'string';
        return isFunction ? 1 : 0;
    }

    //#endregion src/v8/value.ts

    //#region src/v8/node.ts
    /**
     * @__deps $emnapiCtx
     * @__deps $emnapiExternalMemory
     * @__sig pppppp
     */
    function _node_buffer_new(isolate, data, length, callback, hint) {
        data >>>= 0;
        length >>>= 0;
        callback >>>= 0;
        hint >>>= 0;
        if (typeof emnapiCtx.features.Buffer !== 'function') {
            emnapiCtx.isolate.throwException(new Error('Buffer is not supported'));
            return 0;
        }
        const buffer = emnapiExternalMemory.getBufferFrom()(emscripten_runtime.wasmMemory.buffer, data, length >>> 0);
        if (callback) {
            if (!emnapiCtx.features.finalizer) {
                emnapiCtx.isolate.throwException(new Error('Buffer ownership callbacks require runtime finalizer support'));
                return 0;
            }
            const handle = emnapiCtx.napiValueFromJsValue(buffer);
            const call = (emnapiPluginCtx.wasmTable.get(callback));
            const persistent = emnapiCtx.isolate.createReference(buffer);
            persistent.setWeak({ call, data, hint }, (record) => {
                record.call(record.data, record.hint);
            });
            return handle;
        }
        return emnapiCtx.napiValueFromJsValue(buffer);
    }
    /**
     * @__deps $emnapiCtx
     * @__deps $emnapiExternalMemory
     * @__deps malloc
     * @__sig ppp
     */
    function _node_buffer_new_alloc(isolate, length) {
        length >>>= 0;
        if (typeof emnapiCtx.features.Buffer !== 'function') {
            emnapiCtx.isolate.throwException(new Error('Buffer is not supported'));
            return 0;
        }
        let data = emscripten_runtime._malloc(length);
        data >>>= 0;
        new Uint8Array(emscripten_runtime.wasmMemory.buffer).fill(0, data, data + (length >>> 0));
        const buffer = emnapiExternalMemory.getBufferFrom()(emscripten_runtime.wasmMemory.buffer, data, length >>> 0);
        emnapiExternalMemory.registerBufferAllocation(buffer, data, length >>> 0);
        return emnapiCtx.napiValueFromJsValue(buffer);
    }
    /**
     * @__deps $emnapiCtx
     * @__deps $emnapiExternalMemory
     * @__deps malloc
     * @__sig pppp
     */
    function _node_buffer_copy(isolate, data, length) {
        data >>>= 0;
        length >>>= 0;
        if (typeof emnapiCtx.features.Buffer !== 'function') {
            emnapiCtx.isolate.throwException(new Error('Buffer is not supported'));
            return 0;
        }
        let out = emscripten_runtime._malloc(length);
        out >>>= 0;
        const heap = new Uint8Array(emscripten_runtime.wasmMemory.buffer);
        heap.set(heap.subarray(data, data + (length >>> 0)), out);
        const buffer = emnapiExternalMemory.getBufferFrom()(emscripten_runtime.wasmMemory.buffer, out, length >>> 0);
        emnapiExternalMemory.registerBufferAllocation(buffer, out, length >>> 0);
        return emnapiCtx.napiValueFromJsValue(buffer);
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _node_buffer_data(value) {
        const view = emnapiCtx.jsValueFromNapiValue(value);
        return view == null ? 0 : view.byteOffset;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pp
     */
    function _node_buffer_length(value) {
        const view = emnapiCtx.jsValueFromNapiValue(value);
        return view == null ? 0 : view.byteLength;
    }
    /**
     * @__deps $emnapiCtx
     * @__deps $emnapiString
     * @__sig ppppi
     */
    function _node_encode(isolate, buf, len, encoding) {
        buf >>>= 0;
        len >>>= 0;
        if (encoding === 1) {
            return emnapiCtx.napiValueFromJsValue(emnapiString.UTF8ToString(buf, len));
        }
        if (encoding === -1) {
            return emnapiCtx.napiValueFromJsValue(emnapiString.UTF16ToString(buf, len));
        }
        if (encoding === 2) {
            const Buffer = emnapiCtx.features.Buffer;
            if (typeof Buffer !== 'function') {
                emnapiCtx.isolate.throwException(new Error('Buffer is not supported'));
                return 1;
            }
            const buffer = Buffer.from(emscripten_runtime.wasmMemory.buffer, buf, len >>> 0);
            return emnapiCtx.napiValueFromJsValue(buffer.toString('base64'));
        }
        if (encoding === 3) {
            return emnapiCtx.napiValueFromJsValue(emnapiString.UTF16ToString(buf, len / 2));
        }
        if (encoding === 4 || encoding === 0) {
            const heap = new Uint8Array(emscripten_runtime.wasmMemory.buffer);
            let value = '';
            for (let i = 0; i < (len >>> 0); i++)
                value += String.fromCharCode(heap[buf + i]);
            return emnapiCtx.napiValueFromJsValue(value);
        }
        if (encoding === 5) {
            const heap = new Uint8Array(emscripten_runtime.wasmMemory.buffer);
            let value = '';
            for (let i = 0; i < (len >>> 0); i++)
                value += heap[buf + i].toString(16).padStart(2, '0');
            return emnapiCtx.napiValueFromJsValue(value);
        }
        if (encoding === 6) {
            const Buffer = emnapiCtx.features.Buffer;
            if (typeof Buffer !== 'function') {
                emnapiCtx.isolate.throwException(new Error('Buffer is not supported'));
                return 1;
            }
            const buffer = Buffer.from(emscripten_runtime.wasmMemory.buffer, buf, len >>> 0);
            return emnapiCtx.napiValueFromJsValue(buffer);
        }
        emnapiCtx.isolate.throwException(new Error(`Unsupported encoding: ${encoding}`));
        return 1;
    }
    /**
     * @__deps $emnapiCtx
     * @__sig pppppii
     */
    function _node_decode(isolate, output, length, value, encoding, write) {
        output >>>= 0;
        length >>>= 0;
        value >>>= 0;
        try {
            const input = emnapiCtx.jsValueFromNapiValue(value);
            const Buffer = emnapiCtx.features.Buffer;
            let decoded;
            if (typeof Buffer === 'function') {
                if (encoding === 6 && ArrayBuffer.isView(input)) {
                    decoded = Uint8Array.from(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
                }
                else if (encoding === 6) {
                    decoded = Uint8Array.from(Buffer.from(String(input)));
                }
                else {
                    const names = ['ascii', 'utf8', 'base64', 'utf16le', 'latin1', 'hex'];
                    decoded = Uint8Array.from(Buffer.from(String(input), names[encoding]));
                }
            }
            else if (encoding === 1) {
                decoded = new TextEncoder().encode(String(input));
            }
            else if (encoding === 0 || encoding === 4) {
                decoded = Uint8Array.from(String(input), char => char.charCodeAt(0) & 0xff);
            }
            else if (encoding === 2) {
                decoded = Uint8Array.from(atob(String(input)), char => char.charCodeAt(0));
            }
            else if (encoding === 3) {
                const text = String(input);
                decoded = new Uint8Array(text.length * 2);
                const view = new DataView(decoded.buffer);
                for (let i = 0; i < text.length; i++)
                    view.setUint16(i * 2, text.charCodeAt(i), true);
            }
            else if (encoding === 5) {
                const text = String(input);
                decoded = text.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(text)
                    ? new Uint8Array(0)
                    : Uint8Array.from({ length: text.length / 2 }, (_, i) => parseInt(text.slice(i * 2, i * 2 + 2), 16));
            }
            else if (encoding === 6 && ArrayBuffer.isView(input)) {
                decoded = Uint8Array.from(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
            }
            else {
                throw new TypeError(`Unsupported decode input for encoding ${encoding}`);
            }
            if (!write)
                return decoded.byteLength;
            const written = Math.min(Number(length), decoded.byteLength);
            new Uint8Array(emscripten_runtime.wasmMemory.buffer).set(decoded.subarray(0, written), output);
            return written;
        }
        catch (err) {
            emnapiCtx.isolate.throwException(err);
            return -1;
        }
    }
    /**
     * @__deps $emnapiCtx
     * @__deps $emnapiString
     * @__sig ppippp
     */
    function _node_errno_exception(isolate, errorno, syscall, message, path) {
        syscall >>>= 0;
        message >>>= 0;
        path >>>= 0;
        const normalizedErrorno = errorno | 0;
        const syscallValue = syscall ? emnapiString.UTF8ToString(syscall, -1) : undefined;
        const customMessage = message ? emnapiString.UTF8ToString(message, -1) : undefined;
        const pathValue = path ? emnapiString.UTF8ToString(path, -1) : undefined;
        const code = normalizedErrorno === -2 ? 'ENOENT' : `UNKNOWN_${normalizedErrorno}`;
        const description = normalizedErrorno === -2 ? 'no such file or directory' : 'unknown error';
        const detail = customMessage ?? description;
        const suffix = syscallValue
            ? `, ${syscallValue}${pathValue ? ` '${pathValue}'` : ''}`
            : '';
        const error = new Error(`${code}: ${detail}${suffix}`);
        const typedError = error;
        typedError.errno = normalizedErrorno;
        typedError.code = code;
        if (syscallValue !== undefined)
            typedError.syscall = syscallValue;
        if (pathValue !== undefined)
            typedError.path = pathValue;
        return emnapiCtx.napiValueFromJsValue(error);
    }

    //#endregion src/v8/node.ts

    //#region src/v8/index.ts

    //#endregion src/v8/index.ts

    exports._node_buffer_copy = _node_buffer_copy;
    exports._node_buffer_data = _node_buffer_data;
    exports._node_buffer_length = _node_buffer_length;
    exports._node_buffer_new = _node_buffer_new;
    exports._node_buffer_new_alloc = _node_buffer_new_alloc;
    exports._node_decode = _node_decode;
    exports._node_encode = _node_encode;
    exports._node_errno_exception = _node_errno_exception;
    exports._v8_array_buffer_byte_length = _v8_array_buffer_byte_length;
    exports._v8_array_buffer_get_backing_store = _v8_array_buffer_get_backing_store;
    exports._v8_array_buffer_view_buffer = _v8_array_buffer_view_buffer;
    exports._v8_array_buffer_view_byte_length = _v8_array_buffer_view_byte_length;
    exports._v8_array_buffer_view_byte_offset = _v8_array_buffer_view_byte_offset;
    exports._v8_array_length = _v8_array_length;
    exports._v8_array_new = _v8_array_new;
    exports._v8_backing_store_byte_length = _v8_backing_store_byte_length;
    exports._v8_backing_store_data = _v8_backing_store_data;
    exports._v8_backing_store_delete = _v8_backing_store_delete;
    exports._v8_backing_store_set = _v8_backing_store_set;
    exports._v8_boolean_object_new = _v8_boolean_object_new;
    exports._v8_boolean_object_value_of = _v8_boolean_object_value_of;
    exports._v8_boolean_value = _v8_boolean_value;
    exports._v8_cbinfo_holder = _v8_cbinfo_holder;
    exports._v8_cbinfo_new_target = _v8_cbinfo_new_target;
    exports._v8_clear_weak = _v8_clear_weak;
    exports._v8_close_handle_scope = _v8_close_handle_scope;
    exports._v8_context_global = _v8_context_global;
    exports._v8_copy_global_reference = _v8_copy_global_reference;
    exports._v8_date_new = _v8_date_new;
    exports._v8_dispose_global = _v8_dispose_global;
    exports._v8_exception_error = _v8_exception_error;
    exports._v8_exception_range_error = _v8_exception_range_error;
    exports._v8_exception_reference_error = _v8_exception_reference_error;
    exports._v8_exception_syntax_error = _v8_exception_syntax_error;
    exports._v8_exception_type_error = _v8_exception_type_error;
    exports._v8_external_new = _v8_external_new;
    exports._v8_external_value = _v8_external_value;
    exports._v8_function_call = _v8_function_call;
    exports._v8_function_new = _v8_function_new;
    exports._v8_function_new_instance = _v8_function_new_instance;
    exports._v8_function_set_name = _v8_function_set_name;
    exports._v8_function_template_get_function = _v8_function_template_get_function;
    exports._v8_function_template_instance_template = _v8_function_template_instance_template;
    exports._v8_function_template_new = _v8_function_template_new;
    exports._v8_function_template_prototype_template = _v8_function_template_prototype_template;
    exports._v8_function_template_set_call_handler = _v8_function_template_set_call_handler;
    exports._v8_function_template_set_class_name = _v8_function_template_set_class_name;
    exports._v8_get_cb_info = _v8_get_cb_info;
    exports._v8_get_property_cb_info = _v8_get_property_cb_info;
    exports._v8_global_reference_equals = _v8_global_reference_equals;
    exports._v8_global_value_identity = _v8_global_value_identity;
    exports._v8_globalize_reference = _v8_globalize_reference;
    exports._v8_handle_scope_escape = _v8_handle_scope_escape;
    exports._v8_int32_value = _v8_int32_value;
    exports._v8_integer_new = _v8_integer_new;
    exports._v8_integer_new_from_unsigned = _v8_integer_new_from_unsigned;
    exports._v8_integer_value = _v8_integer_value;
    exports._v8_is_weak = _v8_is_weak;
    exports._v8_isolate_get_current_context = _v8_isolate_get_current_context;
    exports._v8_isolate_throw_exception = _v8_isolate_throw_exception;
    exports._v8_json_parse = _v8_json_parse;
    exports._v8_json_stringify = _v8_json_stringify;
    exports._v8_local_from_global_reference = _v8_local_from_global_reference;
    exports._v8_make_weak = _v8_make_weak;
    exports._v8_move_global_reference = _v8_move_global_reference;
    exports._v8_number_new = _v8_number_new;
    exports._v8_number_object_new = _v8_number_object_new;
    exports._v8_number_value = _v8_number_value;
    exports._v8_object_call_as_constructor = _v8_object_call_as_constructor;
    exports._v8_object_call_as_function = _v8_object_call_as_function;
    exports._v8_object_define_own_property = _v8_object_define_own_property;
    exports._v8_object_delete = _v8_object_delete;
    exports._v8_object_delete_index = _v8_object_delete_index;
    exports._v8_object_delete_private = _v8_object_delete_private;
    exports._v8_object_get_aligned_pointer_in_internal_field = _v8_object_get_aligned_pointer_in_internal_field;
    exports._v8_object_get_index = _v8_object_get_index;
    exports._v8_object_get_internal_field = _v8_object_get_internal_field;
    exports._v8_object_get_key = _v8_object_get_key;
    exports._v8_object_get_own_property_names = _v8_object_get_own_property_names;
    exports._v8_object_get_private = _v8_object_get_private;
    exports._v8_object_get_property_attributes = _v8_object_get_property_attributes;
    exports._v8_object_get_property_names = _v8_object_get_property_names;
    exports._v8_object_has = _v8_object_has;
    exports._v8_object_has_index = _v8_object_has_index;
    exports._v8_object_has_own_property = _v8_object_has_own_property;
    exports._v8_object_has_private = _v8_object_has_private;
    exports._v8_object_internal_field_count = _v8_object_internal_field_count;
    exports._v8_object_new = _v8_object_new;
    exports._v8_object_set = _v8_object_set;
    exports._v8_object_set_aligned_pointer_in_internal_field = _v8_object_set_aligned_pointer_in_internal_field;
    exports._v8_object_set_index = _v8_object_set_index;
    exports._v8_object_set_internal_field = _v8_object_set_internal_field;
    exports._v8_object_set_native_data_property = _v8_object_set_native_data_property;
    exports._v8_object_set_private = _v8_object_set_private;
    exports._v8_object_set_prototype = _v8_object_set_prototype;
    exports._v8_object_template_new = _v8_object_template_new;
    exports._v8_object_template_new_instance = _v8_object_template_new_instance;
    exports._v8_object_template_set_call_as_function_handler = _v8_object_template_set_call_as_function_handler;
    exports._v8_object_template_set_indexed_property_handler = _v8_object_template_set_indexed_property_handler;
    exports._v8_object_template_set_internal_field_count = _v8_object_template_set_internal_field_count;
    exports._v8_object_template_set_named_property_handler = _v8_object_template_set_named_property_handler;
    exports._v8_object_template_set_native_data_property = _v8_object_template_set_native_data_property;
    exports._v8_open_handle_scope = _v8_open_handle_scope;
    exports._v8_private_for_api = _v8_private_for_api;
    exports._v8_regex_new = _v8_regex_new;
    exports._v8_release_global_value_identity = _v8_release_global_value_identity;
    exports._v8_retain_global_value_identity = _v8_retain_global_value_identity;
    exports._v8_script_compiler_compile_unbound_script = _v8_script_compiler_compile_unbound_script;
    exports._v8_script_run = _v8_script_run;
    exports._v8_signature_new = _v8_signature_new;
    exports._v8_string_length = _v8_string_length;
    exports._v8_string_new_external_one_byte = _v8_string_new_external_one_byte;
    exports._v8_string_new_external_two_byte = _v8_string_new_external_two_byte;
    exports._v8_string_new_from_one_byte = _v8_string_new_from_one_byte;
    exports._v8_string_new_from_two_byte = _v8_string_new_from_two_byte;
    exports._v8_string_new_from_utf8 = _v8_string_new_from_utf8;
    exports._v8_string_object_new = _v8_string_object_new;
    exports._v8_string_object_value_of = _v8_string_object_value_of;
    exports._v8_string_utf8_length = _v8_string_utf8_length;
    exports._v8_string_write_utf8 = _v8_string_write_utf8;
    exports._v8_template_set = _v8_template_set;
    exports._v8_trycatch_construct = _v8_trycatch_construct;
    exports._v8_trycatch_destruct = _v8_trycatch_destruct;
    exports._v8_trycatch_exception = _v8_trycatch_exception;
    exports._v8_trycatch_has_caught = _v8_trycatch_has_caught;
    exports._v8_trycatch_reset = _v8_trycatch_reset;
    exports._v8_trycatch_rethrow = _v8_trycatch_rethrow;
    exports._v8_uint32_value = _v8_uint32_value;
    exports._v8_unbound_script_bind_to_current_context = _v8_unbound_script_bind_to_current_context;
    exports._v8_value_equals = _v8_value_equals;
    exports._v8_value_is_array_buffer_view = _v8_value_is_array_buffer_view;
    exports._v8_value_is_false = _v8_value_is_false;
    exports._v8_value_is_function = _v8_value_is_function;
    exports._v8_value_is_null = _v8_value_is_null;
    exports._v8_value_is_number = _v8_value_is_number;
    exports._v8_value_is_object = _v8_value_is_object;
    exports._v8_value_is_string = _v8_value_is_string;
    exports._v8_value_is_true = _v8_value_is_true;
    exports._v8_value_is_undefined = _v8_value_is_undefined;
    exports._v8_value_strict_equals = _v8_value_strict_equals;
    exports._v8_value_to_array_index = _v8_value_to_array_index;
    exports._v8_value_to_boolean = _v8_value_to_boolean;
    exports._v8_value_to_int32 = _v8_value_to_int32;
    exports._v8_value_to_integer = _v8_value_to_integer;
    exports._v8_value_to_number = _v8_value_to_number;
    exports._v8_value_to_object = _v8_value_to_object;
    exports._v8_value_to_string = _v8_value_to_string;
    exports._v8_value_to_uint32 = _v8_value_to_uint32;

    return exports;

})({}, emnapiPluginCtx);
  return {
    importObject: (original) => {
      Object.assign(original.env, mod);
    }
  };
}

//#endregion src/emnapi/v8.js

export { v8 as default };
