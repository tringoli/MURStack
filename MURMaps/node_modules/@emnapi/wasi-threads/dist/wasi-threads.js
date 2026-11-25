//#region src/util.ts
const _WebAssembly = typeof WebAssembly !== 'undefined'
    ? WebAssembly
    : typeof WXWebAssembly !== 'undefined'
        ? WXWebAssembly
        : undefined;
const ENVIRONMENT_IS_NODE = typeof process === 'object' && process !== null &&
    typeof process.versions === 'object' && process.versions !== null &&
    typeof process.versions.node === 'string';
function getPostMessage(options) {
    return typeof options?.postMessage === 'function'
        ? options.postMessage
        : typeof postMessage === 'function'
            ? postMessage
            : undefined;
}
function normalizeError(value) {
    if (value instanceof Error)
        return value;
    if (typeof value === 'object' && value !== null && 'error' in value) {
        const nested = value.error;
        if (nested !== undefined && nested !== value)
            return normalizeError(nested);
    }
    const record = typeof value === 'object' && value !== null
        ? value
        : undefined;
    const message = record?.message !== undefined
        ? String(record.message)
        : typeof value === 'string'
            ? value
            : 'Worker sent an unknown error';
    const name = record?.name !== undefined ? String(record.name) : 'Error';
    let error;
    try {
        const ErrorConstructor = name === 'RuntimeError'
            ? (_WebAssembly?.RuntimeError ?? Error)
            : Error;
        error = new ErrorConstructor(message);
    }
    catch (_) {
        error = new Error(message);
    }
    error.name = name;
    if (record?.stack !== undefined) {
        Object.defineProperty(error, 'stack', {
            value: String(record.stack),
            writable: true,
            enumerable: false,
            configurable: true
        });
    }
    if (record?.cause !== undefined) {
        Object.defineProperty(error, 'cause', {
            value: record.cause,
            writable: true,
            enumerable: false,
            configurable: true
        });
    }
    return error;
}
function serializeError(value) {
    const error = normalizeError(value);
    const serialized = {
        name: error.name,
        message: error.message
    };
    if (error.stack !== undefined)
        serialized.stack = error.stack;
    if ('cause' in error && error.cause !== undefined)
        serialized.cause = error.cause;
    return serialized;
}
function deserializeError(value) {
    return normalizeError(value);
}
function serializeErrorToBuffer(sab, code, error) {
    const i32array = new Int32Array(sab);
    Atomics.store(i32array, 0, code);
    if (code > 1 && error) {
        const name = error.name;
        const message = error.message;
        const stack = error.stack ?? '';
        const nameBuffer = new TextEncoder().encode(name);
        const messageBuffer = new TextEncoder().encode(message);
        const stackBuffer = new TextEncoder().encode(stack);
        Atomics.store(i32array, 1, nameBuffer.length);
        Atomics.store(i32array, 2, messageBuffer.length);
        Atomics.store(i32array, 3, stackBuffer.length);
        const buffer = new Uint8Array(sab);
        buffer.set(nameBuffer, 16);
        buffer.set(messageBuffer, 16 + nameBuffer.length);
        buffer.set(stackBuffer, 16 + nameBuffer.length + messageBuffer.length);
    }
}
function deserializeErrorFromBuffer(sab) {
    const i32array = new Int32Array(sab);
    const status = Atomics.load(i32array, 0);
    if (status <= 1) {
        return null;
    }
    const nameLength = Atomics.load(i32array, 1);
    const messageLength = Atomics.load(i32array, 2);
    const stackLength = Atomics.load(i32array, 3);
    const buffer = new Uint8Array(sab);
    const nameBuffer = buffer.slice(16, 16 + nameLength);
    const messageBuffer = buffer.slice(16 + nameLength, 16 + nameLength + messageLength);
    const stackBuffer = buffer.slice(16 + nameLength + messageLength, 16 + nameLength + messageLength + stackLength);
    const name = new TextDecoder().decode(nameBuffer);
    const message = new TextDecoder().decode(messageBuffer);
    const stack = new TextDecoder().decode(stackBuffer);
    const ErrorConstructor = globalThis[name] ?? (name === 'RuntimeError' ? (_WebAssembly.RuntimeError ?? Error) : Error);
    const error = new ErrorConstructor(message);
    Object.defineProperty(error, 'stack', {
        value: stack,
        writable: true,
        enumerable: false,
        configurable: true
    });
    return error;
}
const deserizeErrorFromBuffer = deserializeErrorFromBuffer;
function isSharedArrayBuffer(value) {
    return ((typeof SharedArrayBuffer === 'function' && value instanceof SharedArrayBuffer) ||
        (Object.prototype.toString.call(value) === '[object SharedArrayBuffer]'));
}
function isTrapError(e) {
    try {
        return e instanceof _WebAssembly.RuntimeError || e?.name === 'RuntimeError';
    }
    catch (_) {
        return e?.name === 'RuntimeError';
    }
}

//#endregion src/util.ts

//#region src/command.ts
function createMessage(type, payload) {
    return {
        __emnapi__: {
            type,
            payload
        }
    };
}

//#endregion src/command.ts

//#region src/thread-manager.ts
const WASI_THREADS_MAX_TID = 0x1FFFFFFF;
function checkSharedWasmMemory(wasmMemory) {
    if (wasmMemory) {
        if (!isSharedArrayBuffer(wasmMemory.buffer)) {
            throw new Error('Multithread features require shared wasm memory. ' +
                'Try to compile with `-matomics -mbulk-memory` and use `--import-memory --shared-memory` during linking, ' +
                'then create WebAssembly.Memory with `shared: true` option');
        }
    }
    else {
        if (typeof SharedArrayBuffer === 'undefined') {
            throw new Error('Current environment does not support SharedArrayBuffer, threads are not available!');
        }
    }
}
function getReuseWorker(value) {
    if (typeof value === 'boolean') {
        return value ? { size: 0, strict: false } : false;
    }
    if (typeof value === 'number') {
        if (!(value >= 0)) {
            throw new RangeError('reuseWorker: size must be a non-negative integer');
        }
        return { size: value, strict: false };
    }
    if (!value) {
        return false;
    }
    const size = Number(value.size) || 0;
    const strict = Boolean(value.strict);
    if (!(size > 0) && strict) {
        throw new RangeError('reuseWorker: size must be set to positive integer if strict is set to true');
    }
    return { size, strict };
}
let nextWorkerID = 0;
class ThreadManager {
    get nextWorkerID() { return nextWorkerID; }
    constructor(options) {
        this.unusedWorkers = [];
        this.pthreads = Object.create(null);
        this.wasmModule = null;
        this.wasmMemory = null;
        this.messageEvents = new WeakMap();
        this.registeredWorkers = new Set();
        this.expectedTerminations = new WeakSet();
        this.loadRejects = new WeakMap();
        if (!options) {
            throw new TypeError('ThreadManager(): options is not provided');
        }
        if ('childThread' in options) {
            this._childThread = Boolean(options.childThread);
        }
        else {
            this._childThread = false;
        }
        if (this._childThread) {
            this._onCreateWorker = undefined;
            this._reuseWorker = false;
            this._beforeLoad = undefined;
        }
        else {
            this._onCreateWorker = options.onCreateWorker;
            this._reuseWorker = getReuseWorker(options.reuseWorker);
            this._beforeLoad = options.beforeLoad;
        }
        this.printErr = options.printErr ?? console.error.bind(console);
        this.threadSpawn = options.threadSpawn;
    }
    init() {
        if (!this._childThread) {
            this.initMainThread();
        }
    }
    initMainThread() {
        this.preparePool();
    }
    preparePool() {
        if (this._reuseWorker) {
            if (this._reuseWorker.size) {
                let pthreadPoolSize = this._reuseWorker.size;
                while (pthreadPoolSize--) {
                    this.allocatePoolWorker();
                }
            }
        }
    }
    shouldPreloadWorkers() {
        return !this._childThread && this._reuseWorker && this._reuseWorker.size > 0;
    }
    loadWasmModuleToAllWorkers() {
        const promises = Array(this.unusedWorkers.length);
        for (let i = 0; i < this.unusedWorkers.length; ++i) {
            const worker = this.unusedWorkers[i];
            if (ENVIRONMENT_IS_NODE)
                worker.ref();
            promises[i] = this.loadWasmModuleToWorker(worker).then((w) => {
                if (ENVIRONMENT_IS_NODE)
                    worker.unref();
                return w;
            }, (e) => {
                if (ENVIRONMENT_IS_NODE)
                    worker.unref();
                throw e;
            });
        }
        return Promise.all(promises).catch((err) => {
            this.terminateAllThreads();
            throw err;
        });
    }
    preloadWorkers() {
        if (this.shouldPreloadWorkers()) {
            return this.loadWasmModuleToAllWorkers();
        }
        return Promise.resolve([]);
    }
    setup(wasmModule, wasmMemory) {
        this.wasmModule = wasmModule;
        this.wasmMemory = wasmMemory;
    }
    assertRunning() {
        if (this._fatalError)
            throw this._fatalError;
    }
    fail(value, rethrow) {
        if (this._fatalError)
            return;
        this._fatalError = normalizeError(value);
        this.shutdownAllWorkers(false, this._fatalError);
        if (rethrow) {
            const error = this._fatalError;
            Promise.resolve().then(() => { throw error; });
        }
    }
    markId(worker) {
        this.assertRunning();
        if (worker.__emnapi_tid)
            return worker.__emnapi_tid;
        const tid = nextWorkerID + 43;
        nextWorkerID = (nextWorkerID + 1) % (WASI_THREADS_MAX_TID - 42);
        this.pthreads[tid] = worker;
        worker.__emnapi_tid = tid;
        return tid;
    }
    returnWorkerToPool(worker) {
        if (this._fatalError) {
            this.terminateWorker(worker);
            return;
        }
        var tid = worker.__emnapi_tid;
        if (tid !== undefined) {
            delete this.pthreads[tid];
        }
        this.unusedWorkers.push(worker);
        delete worker.__emnapi_tid;
        if (ENVIRONMENT_IS_NODE) {
            worker.unref();
        }
    }
    loadWasmModuleToWorker(worker, sab) {
        this.assertRunning();
        if (worker.whenLoaded)
            return worker.whenLoaded;
        this.registeredWorkers.add(worker);
        const err = this.printErr;
        const beforeLoad = this._beforeLoad;
        const _this = this;
        worker.whenLoaded = new Promise((resolve, reject) => {
            const handleError = function (e) {
                if (_this.expectedTerminations.has(worker))
                    return;
                let message = 'worker sent an error!';
                if (worker.__emnapi_tid !== undefined) {
                    message = 'worker (tid = ' + worker.__emnapi_tid + ') sent an error!';
                }
                const error = normalizeError(e);
                if (error.message) {
                    err(message + ' ' + error.message);
                }
                else {
                    err(message);
                }
                if (!worker.loaded) {
                    reject(error);
                    _this.dropFailedLoad(worker);
                    return;
                }
                _this.fail(error, !ENVIRONMENT_IS_NODE);
                if (ENVIRONMENT_IS_NODE)
                    throw error;
            };
            const handleMessage = (data) => {
                if (data.__emnapi__) {
                    const type = data.__emnapi__.type;
                    const payload = data.__emnapi__.payload;
                    if (type === 'loaded') {
                        worker.loaded = true;
                        this.loadRejects.delete(worker);
                        if (ENVIRONMENT_IS_NODE && !worker.__emnapi_tid) {
                            worker.unref();
                        }
                        resolve(worker);
                    }
                    else if (type === 'cleanup-thread') {
                        if (payload.tid in this.pthreads) {
                            this.cleanThread(worker, payload.tid);
                        }
                    }
                    else if (type === 'spawn-thread') {
                        this.threadSpawn(payload.startArg, payload.errorOrTid);
                    }
                    else if (type === 'terminate-all-threads') {
                        this.terminateAllThreads();
                    }
                    else if (type === 'thread-error') {
                        const threadError = payload;
                        const error = deserializeError(threadError.error);
                        if (!worker.loaded && threadError.phase === 'load') {
                            reject(error);
                            this.dropFailedLoad(worker);
                        }
                        else {
                            this.fail(error, true);
                        }
                    }
                }
            };
            worker.onmessage = (e) => {
                handleMessage(e.data);
                this.fireMessageEvent(worker, e);
            };
            worker.onerror = handleError;
            worker.onmessageerror = (e) => {
                handleError(normalizeError(e));
            };
            if (ENVIRONMENT_IS_NODE) {
                worker.on('message', function (data) {
                    worker.onmessage?.({
                        data
                    });
                });
                worker.on('error', function (e) {
                    worker.onerror?.(e);
                });
                worker.on('messageerror', function (e) {
                    handleError(normalizeError(e));
                });
                worker.on('exit', function (code) {
                    if (!_this.expectedTerminations.has(worker)) {
                        handleError(new Error('Worker stopped with exit code ' + code));
                    }
                });
                worker.on('detachedExit', function () { });
            }
            this.loadRejects.set(worker, reject);
            try {
                if (typeof beforeLoad === 'function') {
                    beforeLoad(worker);
                }
                worker.postMessage(createMessage('load', {
                    wasmModule: this.wasmModule,
                    wasmMemory: this.wasmMemory,
                    sab
                }));
            }
            catch (caughtError) {
                let error = caughtError;
                try {
                    checkSharedWasmMemory(this.wasmMemory);
                }
                catch (memoryError) {
                    error = memoryError;
                }
                reject(error);
                this.dropFailedLoad(worker);
            }
        });
        return worker.whenLoaded;
    }
    allocateUnusedWorker() {
        this.assertRunning();
        const _onCreateWorker = this._onCreateWorker;
        if (typeof _onCreateWorker !== 'function') {
            throw new TypeError('`options.onCreateWorker` is not provided');
        }
        const worker = _onCreateWorker({ type: 'thread', name: 'emnapi-pthread' });
        this.registeredWorkers.add(worker);
        this.unusedWorkers.push(worker);
        return worker;
    }
    allocatePoolWorker() {
        const worker = this.allocateUnusedWorker();
        if (ENVIRONMENT_IS_NODE) {
            worker.once('message', () => { });
            worker.unref();
        }
        return worker;
    }
    dropFailedLoad(worker) {
        const idle = this.unusedWorkers.indexOf(worker) !== -1;
        this.loadRejects.delete(worker);
        this.terminateWorker(worker);
        if (idle && !this._fatalError)
            this.allocatePoolWorker();
    }
    getNewWorker(sab) {
        this.assertRunning();
        if (this._reuseWorker) {
            if (this.unusedWorkers.length === 0) {
                if (this._reuseWorker.strict) {
                    if (!ENVIRONMENT_IS_NODE) {
                        const err = this.printErr;
                        err('Tried to spawn a new thread, but the thread pool is exhausted.\n' +
                            'This might result in a deadlock unless some threads eventually exit or the code explicitly breaks out to the event loop.');
                        return;
                    }
                }
                return this.allocateAndLoadWorker(sab);
            }
            const worker = this.unusedWorkers.pop();
            if (!worker.whenLoaded) {
                this.loadWasmModuleToWorker(worker, sab);
            }
            return worker;
        }
        return this.allocateAndLoadWorker(sab);
    }
    allocateAndLoadWorker(sab) {
        const worker = this.allocateUnusedWorker();
        this.unusedWorkers.pop();
        this.loadWasmModuleToWorker(worker, sab);
        return this.expectedTerminations.has(worker) ? undefined : worker;
    }
    cleanThread(worker, tid, force) {
        if (!force && this._reuseWorker) {
            this.returnWorkerToPool(worker);
        }
        else {
            delete this.pthreads[tid];
            this.terminateWorker(worker);
            delete worker.__emnapi_tid;
        }
    }
    terminateWorker(worker) {
        const tid = worker.__emnapi_tid;
        this.expectedTerminations.add(worker);
        this.registeredWorkers.delete(worker);
        const index = this.unusedWorkers.indexOf(worker);
        if (index !== -1)
            this.unusedWorkers.splice(index, 1);
        this.loadRejects.delete(worker);
        worker.terminate();
        this.messageEvents.get(worker)?.clear();
        this.messageEvents.delete(worker);
        worker.onmessage = (e) => {
            if (e.data.__emnapi__) {
                const type = e.data.__emnapi__.type;
                if (type === 'loaded')
                    return;
                const err = this.printErr;
                err('received "' + type + '" command from terminated worker: ' + tid);
            }
        };
    }
    terminateAllThreads() {
        this.shutdownAllWorkers(true);
    }
    shutdownAllWorkers(recreatePool, reason) {
        const workers = new Set([
            ...this.registeredWorkers,
            ...Object.values(this.pthreads),
            ...this.unusedWorkers
        ]);
        workers.forEach((worker) => {
            if (reason)
                this.loadRejects.get(worker)?.(reason);
            this.terminateWorker(worker);
        });
        this.unusedWorkers = [];
        this.pthreads = Object.create(null);
        if (recreatePool && !this._fatalError)
            this.preparePool();
    }
    addMessageEventListener(worker, onMessage) {
        let listeners = this.messageEvents.get(worker);
        if (!listeners) {
            listeners = new Set();
            this.messageEvents.set(worker, listeners);
        }
        listeners.add(onMessage);
        return () => {
            listeners?.delete(onMessage);
        };
    }
    fireMessageEvent(worker, e) {
        const listeners = this.messageEvents.get(worker);
        if (!listeners)
            return;
        const err = this.printErr;
        listeners.forEach((listener) => {
            try {
                listener(e);
            }
            catch (e) {
                err(e.stack);
            }
        });
    }
}

//#endregion src/thread-manager.ts

//#region src/proxy.ts
const kIsProxy = Symbol('kIsProxy');
function createInstanceProxy(instance, memory) {
    if (instance[kIsProxy])
        return instance;
    const originalExports = instance.exports;
    const createHandler = function (target) {
        const handlers = [
            'apply',
            'construct',
            'defineProperty',
            'deleteProperty',
            'get',
            'getOwnPropertyDescriptor',
            'getPrototypeOf',
            'has',
            'isExtensible',
            'ownKeys',
            'preventExtensions',
            'set',
            'setPrototypeOf'
        ];
        const handler = {};
        for (let i = 0; i < handlers.length; i++) {
            const name = handlers[i];
            handler[name] = function () {
                const args = Array.prototype.slice.call(arguments, 1);
                args.unshift(target);
                return Reflect[name].apply(Reflect, args);
            };
        }
        return handler;
    };
    const handler = createHandler(originalExports);
    const _initialize = () => { };
    const _start = () => 0;
    handler.get = function (_target, p, receiver) {
        if (p === 'memory') {
            return (typeof memory === 'function' ? memory() : memory) ?? Reflect.get(originalExports, p, receiver);
        }
        if (p === '_initialize') {
            return p in originalExports ? _initialize : undefined;
        }
        if (p === '_start') {
            return p in originalExports ? _start : undefined;
        }
        return Reflect.get(originalExports, p, receiver);
    };
    handler.has = function (_target, p) {
        if (p === 'memory')
            return true;
        return Reflect.has(originalExports, p);
    };
    const exportsProxy = new Proxy(Object.create(null), handler);
    return new Proxy(instance, {
        get(target, p, receiver) {
            if (p === 'exports') {
                return exportsProxy;
            }
            if (p === kIsProxy) {
                return true;
            }
            return Reflect.get(target, p, receiver);
        }
    });
}

//#endregion src/proxy.ts

//#region src/wasi-threads.ts
const patchedWasiInstances = new WeakMap();
const THREAD_SPAWN_RESULT_SIZE = Int32Array.BYTES_PER_ELEMENT * 2;
const sharedArrayBufferByteLength = typeof SharedArrayBuffer === 'function'
    ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength').get
    : undefined;
function isConclusivelySharedArrayBuffer(buffer) {
    if (sharedArrayBufferByteLength === undefined)
        return false;
    try {
        sharedArrayBufferByteLength.call(buffer);
        return true;
    }
    catch (_) {
        return false;
    }
}
function getThreadSpawnResultView(memory, address, wasm64) {
    const offset = typeof address === 'bigint' ? Number(address) : address >>> 0;
    let buffer = memory.buffer;
    if (offset + THREAD_SPAWN_RESULT_SIZE > buffer.byteLength &&
        isConclusivelySharedArrayBuffer(buffer)) {
        if (wasm64) {
            memory.grow(BigInt(0));
        }
        else {
            memory.grow(0);
        }
        buffer = memory.buffer;
    }
    return new Int32Array(buffer, offset, 2);
}
class WASIThreads {
    constructor(options) {
        if (!options) {
            throw new TypeError('WASIThreads(): options is not provided');
        }
        if (!options.wasi) {
            throw new TypeError('WASIThreads(): options.wasi is not provided');
        }
        patchedWasiInstances.set(this, new WeakSet());
        const wasi = options.wasi;
        patchWasiInstance(this, wasi);
        this.wasi = wasi;
        if ('childThread' in options) {
            this.childThread = Boolean(options.childThread);
        }
        else {
            this.childThread = false;
        }
        this.PThread = undefined;
        if ('threadManager' in options) {
            if (typeof options.threadManager === 'function') {
                this.PThread = options.threadManager();
            }
            else {
                this.PThread = options.threadManager;
            }
        }
        else {
            if (!this.childThread) {
                this.PThread = new ThreadManager(options);
                this.PThread.init();
            }
        }
        let waitThreadStart = false;
        if ('waitThreadStart' in options) {
            waitThreadStart = typeof options.waitThreadStart === 'number' ? options.waitThreadStart : Boolean(options.waitThreadStart);
        }
        const postMessage = getPostMessage(options);
        if (this.childThread && typeof postMessage !== 'function') {
            throw new TypeError('options.postMessage is not a function');
        }
        this.postMessage = postMessage;
        const wasm64 = Boolean(options.wasm64);
        const threadSpawn = (startArg, errorOrTid) => {
            const EAGAIN = 6;
            const isNewABI = errorOrTid !== undefined;
            try {
                checkSharedWasmMemory(this.wasmMemory);
            }
            catch (err) {
                this.PThread?.printErr(err.stack);
                if (isNewABI) {
                    const struct = getThreadSpawnResultView(this.wasmMemory, errorOrTid, wasm64);
                    Atomics.store(struct, 0, 1);
                    Atomics.store(struct, 1, EAGAIN);
                    Atomics.notify(struct, 1);
                    return 1;
                }
                else {
                    return -EAGAIN;
                }
            }
            if (!isNewABI) {
                const malloc = this.wasmInstance.exports.malloc;
                errorOrTid = wasm64 ? Number(malloc(BigInt(8))) : (malloc(8) >>> 0);
                if (!errorOrTid) {
                    return -48;
                }
            }
            const _free = this.wasmInstance.exports.free;
            const free = wasm64 ? (ptr) => { _free(BigInt(ptr)); } : _free;
            const struct = getThreadSpawnResultView(this.wasmMemory, errorOrTid, wasm64);
            Atomics.store(struct, 0, 0);
            Atomics.store(struct, 1, 0);
            if (this.childThread) {
                postMessage(createMessage('spawn-thread', {
                    startArg,
                    errorOrTid: errorOrTid
                }));
                Atomics.wait(struct, 1, 0);
                const isError = Atomics.load(struct, 0);
                const result = Atomics.load(struct, 1);
                if (isNewABI) {
                    return isError;
                }
                free(errorOrTid);
                return isError ? -result : result;
            }
            const shouldWait = waitThreadStart || (waitThreadStart === 0);
            let sab;
            if (shouldWait) {
                sab = new Int32Array(new SharedArrayBuffer(16 + 8192));
                Atomics.store(sab, 0, 0);
            }
            let worker;
            let tid;
            const PThread = this.PThread;
            try {
                worker = PThread.getNewWorker(sab);
                if (!worker) {
                    throw new Error('failed to get new worker');
                }
                tid = PThread.markId(worker);
                if (ENVIRONMENT_IS_NODE) {
                    worker.unref();
                }
                worker.postMessage(createMessage('start', {
                    tid,
                    arg: startArg,
                    sab
                }));
                if (shouldWait) {
                    if (typeof waitThreadStart === 'number') {
                        const waitResult = Atomics.wait(sab, 0, 0, waitThreadStart);
                        if (waitResult === 'timed-out') {
                            throw new Error('Spawning thread timed out. Please check if the worker is created successfully and if message is handled properly in the worker.');
                        }
                    }
                    else {
                        Atomics.wait(sab, 0, 0);
                    }
                    const r = Atomics.load(sab, 0);
                    if (r > 1) {
                        throw deserizeErrorFromBuffer(sab.buffer);
                    }
                }
            }
            catch (e) {
                if (worker !== undefined && tid !== undefined) {
                    try {
                        PThread.cleanThread(worker, tid, true);
                    }
                    catch (_) { }
                }
                Atomics.store(struct, 0, 1);
                Atomics.store(struct, 1, EAGAIN);
                Atomics.notify(struct, 1);
                PThread?.printErr(e.stack);
                if (isNewABI) {
                    return 1;
                }
                free(errorOrTid);
                return -EAGAIN;
            }
            Atomics.store(struct, 0, 0);
            Atomics.store(struct, 1, tid);
            Atomics.notify(struct, 1);
            if (!shouldWait) {
                worker.whenLoaded.catch((err) => {
                    delete worker.whenLoaded;
                    PThread.cleanThread(worker, tid, true);
                    PThread.printErr('failed to load the worker of thread ' + tid + ': ' + ((err && err.stack) || err));
                });
            }
            if (isNewABI) {
                return 0;
            }
            free(errorOrTid);
            return tid;
        };
        this.threadSpawn = threadSpawn;
        if (this.PThread) {
            this.PThread.threadSpawn = threadSpawn;
        }
    }
    getImportObject() {
        return {
            wasi: {
                'thread-spawn': this.threadSpawn
            }
        };
    }
    setup(wasmInstance, wasmModule, wasmMemory) {
        wasmMemory ??= wasmInstance.exports.memory;
        this.wasmInstance = wasmInstance;
        this.wasmMemory = wasmMemory;
        if (this.PThread) {
            this.PThread.setup(wasmModule, wasmMemory);
        }
    }
    preloadWorkers() {
        if (this.PThread) {
            return this.PThread.preloadWorkers();
        }
        return Promise.resolve([]);
    }
    initialize(instance, module, memory) {
        const exports = instance.exports;
        memory ??= exports.memory;
        if (this.childThread) {
            instance = createInstanceProxy(instance, memory);
        }
        this.setup(instance, module, memory);
        const wasi = this.wasi;
        if (('_start' in exports) && (typeof exports._start === 'function')) {
            if (this.childThread) {
                wasi.start(instance);
                try {
                    const kStarted = getWasiSymbol(wasi, 'kStarted');
                    wasi[kStarted] = false;
                }
                catch (_) { }
            }
            else {
                setupInstance(wasi, instance);
            }
        }
        else {
            wasi.initialize(instance);
        }
        return instance;
    }
    start(instance, module, memory) {
        const exports = instance.exports;
        memory ??= exports.memory;
        if (this.childThread) {
            instance = createInstanceProxy(instance, memory);
        }
        this.setup(instance, module, memory);
        const exitCode = this.wasi.start(instance);
        return { exitCode, instance };
    }
    terminateAllThreads() {
        if (!this.childThread) {
            this.PThread?.terminateAllThreads();
        }
        else {
            this.postMessage(createMessage('terminate-all-threads', {}));
        }
    }
}
function patchWasiInstance(wasiThreads, wasi) {
    const patched = patchedWasiInstances.get(wasiThreads);
    if (patched.has(wasi)) {
        return;
    }
    const _this = wasiThreads;
    const wasiImport = wasi.wasiImport;
    if (wasiImport) {
        const proc_exit = wasiImport.proc_exit;
        wasiImport.proc_exit = function (code) {
            _this.terminateAllThreads();
            return proc_exit.call(this, code);
        };
    }
    if (!_this.childThread) {
        const start = wasi.start;
        if (typeof start === 'function') {
            wasi.start = function (instance) {
                try {
                    return start.call(this, instance);
                }
                catch (err) {
                    if (isTrapError(err)) {
                        _this.terminateAllThreads();
                    }
                    throw err;
                }
            };
        }
    }
    patched.add(wasi);
}
function getWasiSymbol(wasi, description) {
    const symbols = Object.getOwnPropertySymbols(wasi);
    const selectDescription = (description) => (s) => {
        if (s.description) {
            return s.description === description;
        }
        return s.toString() === `Symbol(${description})`;
    };
    if (Array.isArray(description)) {
        return description.map(d => symbols.filter(selectDescription(d))[0]);
    }
    return symbols.filter(selectDescription(description))[0];
}
function setupInstance(wasi, instance) {
    const [kInstance, kSetMemory] = getWasiSymbol(wasi, ['kInstance', 'kSetMemory']);
    wasi[kInstance] = instance;
    wasi[kSetMemory](instance.exports.memory);
}

//#endregion src/wasi-threads.ts

//#region src/worker.ts
class ThreadMessageHandler {
    constructor(options) {
        const postMsg = getPostMessage(options);
        if (typeof postMsg !== 'function') {
            throw new TypeError('options.postMessage is not a function');
        }
        this.postMessage = postMsg;
        this.onLoad = options?.onLoad;
        this.onError = typeof options?.onError === 'function' ? options.onError : (error) => { throw error; };
        this.instance = undefined;
        this.messagesBeforeLoad = [];
    }
    instantiate(data) {
        if (typeof this.onLoad === 'function') {
            return this.onLoad(data);
        }
        throw new Error('ThreadMessageHandler.prototype.instantiate is not implemented');
    }
    handle(e) {
        if (e?.data?.__emnapi__) {
            const type = e.data.__emnapi__.type;
            const payload = e.data.__emnapi__.payload;
            try {
                if (type === 'load') {
                    this._load(payload);
                }
                else if (type === 'start') {
                    this.handleAfterLoad(e, () => {
                        this._start(payload);
                    });
                }
            }
            catch (err) {
                const tid = type === 'start' ? payload.tid : undefined;
                this.reportError(err, type, tid);
            }
        }
    }
    _load(payload) {
        if (this.instance !== undefined)
            return;
        let source;
        try {
            source = this.instantiate(payload);
        }
        catch (err) {
            this._loaded(err, null, payload);
            return;
        }
        const then = source && 'then' in source ? source.then : undefined;
        if (typeof then === 'function') {
            then.call(source, (source) => { this._loaded(null, source, payload); }, (err) => {
                try {
                    this._loaded(normalizeError(err), null, payload);
                }
                catch (loadError) {
                    this.reportError(loadError, 'load');
                }
            });
        }
        else {
            this._loaded(null, source, payload);
        }
    }
    _start(payload) {
        const wasi_thread_start = this.instance.exports.wasi_thread_start;
        if (typeof wasi_thread_start !== 'function') {
            const err = new TypeError('wasi_thread_start is not exported');
            notifyPthreadCreateResult(payload.sab, 2, err);
            throw err;
        }
        const postMessage = this.postMessage;
        const tid = payload.tid;
        const startArg = payload.arg;
        notifyPthreadCreateResult(payload.sab, 1);
        try {
            wasi_thread_start(tid, startArg);
        }
        catch (err) {
            if (err !== 'unwind') {
                throw err;
            }
            else {
                return;
            }
        }
        postMessage(createMessage('cleanup-thread', { tid }));
    }
    _loaded(err, source, payload) {
        if (err) {
            notifyPthreadCreateResult(payload.sab, 2, err);
            this._failQueuedStarts(err);
            throw err;
        }
        if (source == null) {
            const err = new TypeError('onLoad should return an object');
            notifyPthreadCreateResult(payload.sab, 2, err);
            this._failQueuedStarts(err);
            throw err;
        }
        const instance = source.instance;
        if (!instance) {
            const err = new TypeError('onLoad should return an object which includes "instance"');
            notifyPthreadCreateResult(payload.sab, 2, err);
            this._failQueuedStarts(err);
            throw err;
        }
        this.instance = instance;
        const postMessage = this.postMessage;
        postMessage(createMessage('loaded', {}));
        const messages = this.messagesBeforeLoad;
        this.messagesBeforeLoad = [];
        for (let i = 0; i < messages.length; i++) {
            const data = messages[i];
            this.handle({ data });
        }
    }
    _failQueuedStarts(err) {
        this.messagesBeforeLoad = this.messagesBeforeLoad.filter((data) => {
            if (data?.__emnapi__?.type !== 'start')
                return true;
            notifyPthreadCreateResult(data.__emnapi__.payload.sab, 2, err);
            return false;
        });
    }
    handleAfterLoad(e, f) {
        if (this.instance !== undefined) {
            f.call(this, e);
        }
        else {
            this.messagesBeforeLoad.push(e.data);
        }
    }
    beforeReportError(_error, _type, _tid) { }
    reportError(value, type, tid) {
        const error = normalizeError(value);
        this.beforeReportError(error, type, tid);
        const phase = type === 'async-worker-init' ? 'async-work' : type;
        const report = () => {
            try {
                this.postMessage(createMessage('thread-error', {
                    error: serializeError(error),
                    phase,
                    tid
                }));
            }
            catch (_) { }
        };
        if (ENVIRONMENT_IS_NODE) {
            this.onError(error, type);
            report();
        }
        else {
            report();
            this.onError(error, type);
        }
    }
}
function notifyPthreadCreateResult(sab, result, error) {
    if (sab) {
        serializeErrorToBuffer(sab.buffer, result, error);
        Atomics.notify(sab, 0);
    }
}

//#endregion src/worker.ts

export { ThreadManager, ThreadMessageHandler, WASIThreads, createInstanceProxy, isSharedArrayBuffer, isTrapError };
