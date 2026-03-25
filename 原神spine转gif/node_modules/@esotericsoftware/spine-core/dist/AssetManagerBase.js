/******************************************************************************
 * Spine Runtimes License Agreement
 * Last updated April 5, 2025. Replaces all prior versions.
 *
 * Copyright (c) 2013-2025, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software
 * or otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THE SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/
import { TextureAtlas } from "./TextureAtlas.js";
export class AssetManagerBase {
    pathPrefix = "";
    textureLoader;
    downloader;
    cache;
    errors = {};
    toLoad = 0;
    loaded = 0;
    constructor(textureLoader, pathPrefix = "", downloader = new Downloader(), cache = new AssetCache()) {
        this.textureLoader = textureLoader;
        this.pathPrefix = pathPrefix;
        this.downloader = downloader;
        this.cache = cache;
    }
    start(path) {
        this.toLoad++;
        return this.pathPrefix + path;
    }
    success(callback, path, asset) {
        this.toLoad--;
        this.loaded++;
        this.cache.assets[path] = asset;
        this.cache.assetsRefCount[path] = (this.cache.assetsRefCount[path] || 0) + 1;
        if (callback)
            callback(path, asset);
    }
    error(callback, path, message) {
        this.toLoad--;
        this.loaded++;
        this.errors[path] = message;
        if (callback)
            callback(path, message);
    }
    loadAll() {
        let promise = new Promise((resolve, reject) => {
            let check = () => {
                if (this.isLoadingComplete()) {
                    if (this.hasErrors())
                        reject(this.errors);
                    else
                        resolve(this);
                    return;
                }
                requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
        });
        return promise;
    }
    setRawDataURI(path, data) {
        this.downloader.rawDataUris[this.pathPrefix + path] = data;
    }
    loadBinary(path, success = () => { }, error = () => { }) {
        path = this.start(path);
        if (this.reuseAssets(path, success, error))
            return;
        this.cache.assetsLoaded[path] = new Promise((resolve, reject) => {
            this.downloader.downloadBinary(path, (data) => {
                this.success(success, path, data);
                resolve(data);
            }, (status, responseText) => {
                const errorMsg = `Couldn't load binary ${path}: status ${status}, ${responseText}`;
                this.error(error, path, errorMsg);
                reject(errorMsg);
            });
        });
    }
    loadText(path, success = () => { }, error = () => { }) {
        path = this.start(path);
        this.downloader.downloadText(path, (data) => {
            this.success(success, path, data);
        }, (status, responseText) => {
            this.error(error, path, `Couldn't load text ${path}: status ${status}, ${responseText}`);
        });
    }
    loadJson(path, success = () => { }, error = () => { }) {
        path = this.start(path);
        if (this.reuseAssets(path, success, error))
            return;
        this.cache.assetsLoaded[path] = new Promise((resolve, reject) => {
            this.downloader.downloadJson(path, (data) => {
                this.success(success, path, data);
                resolve(data);
            }, (status, responseText) => {
                const errorMsg = `Couldn't load JSON ${path}: status ${status}, ${responseText}`;
                this.error(error, path, errorMsg);
                reject(errorMsg);
            });
        });
    }
    reuseAssets(path, success = () => { }, error = () => { }) {
        const loadedStatus = this.cache.assetsLoaded[path];
        const alreadyExistsOrLoading = loadedStatus !== undefined;
        if (alreadyExistsOrLoading) {
            this.cache.assetsLoaded[path] = loadedStatus
                .then(data => {
                // necessary when user preloads an image into the cache.
                // texture loader is not avaiable in the cache, so we transform in GLTexture at first use
                data = (data instanceof Image || data instanceof ImageBitmap) ? this.textureLoader(data) : data;
                this.success(success, path, data);
                return data;
            })
                .catch(errorMsg => this.error(error, path, errorMsg));
        }
        return alreadyExistsOrLoading;
    }
    loadTexture(path, success = () => { }, error = () => { }) {
        path = this.start(path);
        if (this.reuseAssets(path, success, error))
            return;
        this.cache.assetsLoaded[path] = new Promise((resolve, reject) => {
            let isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document);
            let isWebWorker = !isBrowser; // && typeof importScripts !== 'undefined';
            if (isWebWorker) {
                fetch(path, { mode: "cors" }).then((response) => {
                    if (response.ok)
                        return response.blob();
                    const errorMsg = `Couldn't load image: ${path}`;
                    this.error(error, path, `Couldn't load image: ${path}`);
                    reject(errorMsg);
                }).then((blob) => {
                    return blob ? createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" }) : null;
                }).then((bitmap) => {
                    if (bitmap) {
                        const texture = this.createTexture(path, bitmap);
                        this.success(success, path, texture);
                        resolve(texture);
                    }
                    ;
                });
            }
            else {
                let image = new Image();
                image.crossOrigin = "anonymous";
                image.onload = () => {
                    const texture = this.createTexture(path, image);
                    this.success(success, path, texture);
                    resolve(texture);
                };
                image.onerror = () => {
                    const errorMsg = `Couldn't load image: ${path}`;
                    this.error(error, path, errorMsg);
                    reject(errorMsg);
                };
                if (this.downloader.rawDataUris[path])
                    path = this.downloader.rawDataUris[path];
                image.src = path;
            }
        });
    }
    loadTextureAtlas(path, success = () => { }, error = () => { }, fileAlias) {
        let index = path.lastIndexOf("/");
        let parent = index >= 0 ? path.substring(0, index + 1) : "";
        path = this.start(path);
        if (this.reuseAssets(path, success, error))
            return;
        this.cache.assetsLoaded[path] = new Promise((resolve, reject) => {
            this.downloader.downloadText(path, (atlasText) => {
                try {
                    const atlas = this.createTextureAtlas(path, atlasText);
                    let toLoad = atlas.pages.length, abort = false;
                    for (let page of atlas.pages) {
                        this.loadTexture(!fileAlias ? parent + page.name : fileAlias[page.name], (imagePath, texture) => {
                            if (!abort) {
                                page.setTexture(texture);
                                if (--toLoad == 0) {
                                    this.success(success, path, atlas);
                                    resolve(atlas);
                                }
                            }
                        }, (imagePath, message) => {
                            if (!abort) {
                                const errorMsg = `Couldn't load texture ${path} page image: ${imagePath}`;
                                this.error(error, path, errorMsg);
                                reject(errorMsg);
                            }
                            abort = true;
                        });
                    }
                }
                catch (e) {
                    const errorMsg = `Couldn't parse texture atlas ${path}: ${e.message}`;
                    this.error(error, path, errorMsg);
                    reject(errorMsg);
                }
            }, (status, responseText) => {
                const errorMsg = `Couldn't load texture atlas ${path}: status ${status}, ${responseText}`;
                this.error(error, path, errorMsg);
                reject(errorMsg);
            });
        });
    }
    loadTextureAtlasButNoTextures(path, success = () => { }, error = () => { }, fileAlias) {
        path = this.start(path);
        if (this.reuseAssets(path, success, error))
            return;
        this.cache.assetsLoaded[path] = new Promise((resolve, reject) => {
            this.downloader.downloadText(path, (atlasText) => {
                try {
                    const atlas = this.createTextureAtlas(path, atlasText);
                    this.success(success, path, atlas);
                    resolve(atlas);
                }
                catch (e) {
                    const errorMsg = `Couldn't parse texture atlas ${path}: ${e.message}`;
                    this.error(error, path, errorMsg);
                    reject(errorMsg);
                }
            }, (status, responseText) => {
                const errorMsg = `Couldn't load texture atlas ${path}: status ${status}, ${responseText}`;
                this.error(error, path, errorMsg);
                reject(errorMsg);
            });
        });
    }
    // Promisified versions of load function
    async loadBinaryAsync(path) {
        return new Promise((resolve, reject) => {
            this.loadBinary(path, (_, binary) => resolve(binary), (_, message) => reject(message));
        });
    }
    async loadJsonAsync(path) {
        return new Promise((resolve, reject) => {
            this.loadJson(path, (_, object) => resolve(object), (_, message) => reject(message));
        });
    }
    async loadTextureAsync(path) {
        return new Promise((resolve, reject) => {
            this.loadTexture(path, (_, texture) => resolve(texture), (_, message) => reject(message));
        });
    }
    async loadTextureAtlasAsync(path) {
        return new Promise((resolve, reject) => {
            this.loadTextureAtlas(path, (_, atlas) => resolve(atlas), (_, message) => reject(message));
        });
    }
    async loadTextureAtlasButNoTexturesAsync(path) {
        return new Promise((resolve, reject) => {
            this.loadTextureAtlasButNoTextures(path, (_, atlas) => resolve(atlas), (_, message) => reject(message));
        });
    }
    setCache(cache) {
        this.cache = cache;
    }
    get(path) {
        return this.cache.assets[this.pathPrefix + path];
    }
    require(path) {
        path = this.pathPrefix + path;
        let asset = this.cache.assets[path];
        if (asset)
            return asset;
        let error = this.errors[path];
        throw Error("Asset not found: " + path + (error ? "\n" + error : ""));
    }
    remove(path) {
        path = this.pathPrefix + path;
        let asset = this.cache.assets[path];
        if (asset.dispose)
            asset.dispose();
        delete this.cache.assets[path];
        delete this.cache.assetsRefCount[path];
        delete this.cache.assetsLoaded[path];
        return asset;
    }
    removeAll() {
        for (let path in this.cache.assets) {
            let asset = this.cache.assets[path];
            if (asset.dispose)
                asset.dispose();
        }
        this.cache.assets = {};
        this.cache.assetsLoaded = {};
        this.cache.assetsRefCount = {};
    }
    isLoadingComplete() {
        return this.toLoad == 0;
    }
    getToLoad() {
        return this.toLoad;
    }
    getLoaded() {
        return this.loaded;
    }
    dispose() {
        this.removeAll();
    }
    // dispose asset only if it's not used by others
    disposeAsset(path) {
        const asset = this.cache.assets[path];
        if (asset instanceof TextureAtlas) {
            asset.dispose();
            return;
        }
        this.disposeAssetInternal(path);
    }
    hasErrors() {
        return Object.keys(this.errors).length > 0;
    }
    getErrors() {
        return this.errors;
    }
    disposeAssetInternal(path) {
        if (this.cache.assetsRefCount[path] > 0 && --this.cache.assetsRefCount[path] === 0) {
            return this.remove(path);
        }
    }
    createTextureAtlas(path, atlasText) {
        const atlas = new TextureAtlas(atlasText);
        atlas.dispose = () => {
            if (this.cache.assetsRefCount[path] <= 0)
                return;
            this.disposeAssetInternal(path);
            for (const page of atlas.pages) {
                page.texture?.dispose();
            }
        };
        return atlas;
    }
    createTexture(path, image) {
        const texture = this.textureLoader(image);
        const textureDispose = texture.dispose.bind(texture);
        texture.dispose = () => {
            if (this.disposeAssetInternal(path))
                textureDispose();
        };
        return texture;
    }
}
export class AssetCache {
    assets = {};
    assetsRefCount = {};
    assetsLoaded = {};
    static AVAILABLE_CACHES = new Map();
    static getCache(id) {
        const cache = AssetCache.AVAILABLE_CACHES.get(id);
        if (cache)
            return cache;
        const newCache = new AssetCache();
        AssetCache.AVAILABLE_CACHES.set(id, newCache);
        return newCache;
    }
    async addAsset(path, asset) {
        this.assetsLoaded[path] = Promise.resolve(asset);
        this.assets[path] = await asset;
    }
}
export class Downloader {
    callbacks = {};
    rawDataUris = {};
    dataUriToString(dataUri) {
        if (!dataUri.startsWith("data:")) {
            throw new Error("Not a data URI.");
        }
        let base64Idx = dataUri.indexOf("base64,");
        if (base64Idx != -1) {
            base64Idx += "base64,".length;
            return atob(dataUri.substr(base64Idx));
        }
        else {
            return dataUri.substr(dataUri.indexOf(",") + 1);
        }
    }
    base64ToUint8Array(base64) {
        var binary_string = window.atob(base64);
        var len = binary_string.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes;
    }
    dataUriToUint8Array(dataUri) {
        if (!dataUri.startsWith("data:")) {
            throw new Error("Not a data URI.");
        }
        let base64Idx = dataUri.indexOf("base64,");
        if (base64Idx == -1)
            throw new Error("Not a binary data URI.");
        base64Idx += "base64,".length;
        return this.base64ToUint8Array(dataUri.substr(base64Idx));
    }
    downloadText(url, success, error) {
        if (this.start(url, success, error))
            return;
        const rawDataUri = this.rawDataUris[url];
        // we assume if a "." is included in a raw data uri, it is used to rewrite an asset URL
        if (rawDataUri && !rawDataUri.includes(".")) {
            try {
                this.finish(url, 200, this.dataUriToString(rawDataUri));
            }
            catch (e) {
                this.finish(url, 400, JSON.stringify(e));
            }
            return;
        }
        let request = new XMLHttpRequest();
        request.overrideMimeType("text/html");
        request.open("GET", rawDataUri ? rawDataUri : url, true);
        let done = () => {
            this.finish(url, request.status, request.responseText);
        };
        request.onload = done;
        request.onerror = done;
        request.send();
    }
    downloadJson(url, success, error) {
        this.downloadText(url, (data) => {
            success(JSON.parse(data));
        }, error);
    }
    downloadBinary(url, success, error) {
        if (this.start(url, success, error))
            return;
        const rawDataUri = this.rawDataUris[url];
        // we assume if a "." is included in a raw data uri, it is used to rewrite an asset URL
        if (rawDataUri && !rawDataUri.includes(".")) {
            try {
                this.finish(url, 200, this.dataUriToUint8Array(rawDataUri));
            }
            catch (e) {
                this.finish(url, 400, JSON.stringify(e));
            }
            return;
        }
        let request = new XMLHttpRequest();
        request.open("GET", rawDataUri ? rawDataUri : url, true);
        request.responseType = "arraybuffer";
        let onerror = () => {
            this.finish(url, request.status, request.response);
        };
        request.onload = () => {
            if (request.status == 200 || request.status == 0)
                this.finish(url, 200, new Uint8Array(request.response));
            else
                onerror();
        };
        request.onerror = onerror;
        request.send();
    }
    start(url, success, error) {
        let callbacks = this.callbacks[url];
        try {
            if (callbacks)
                return true;
            this.callbacks[url] = callbacks = [];
        }
        finally {
            callbacks.push(success, error);
        }
    }
    finish(url, status, data) {
        let callbacks = this.callbacks[url];
        delete this.callbacks[url];
        let args = status == 200 || status == 0 ? [data] : [status, data];
        for (let i = args.length - 1, n = callbacks.length; i < n; i += 2)
            callbacks[i].apply(null, args);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQXNzZXRNYW5hZ2VyQmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9Bc3NldE1hbmFnZXJCYXNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7K0VBMkIrRTtBQUcvRSxPQUFPLEVBQUUsWUFBWSxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFHakQsTUFBTSxPQUFPLGdCQUFnQjtJQUNwQixVQUFVLEdBQVcsRUFBRSxDQUFDO0lBQ3hCLGFBQWEsQ0FBcUQ7SUFDbEUsVUFBVSxDQUFhO0lBQ3ZCLEtBQUssQ0FBYTtJQUNsQixNQUFNLEdBQXNCLEVBQUUsQ0FBQztJQUMvQixNQUFNLEdBQUcsQ0FBQyxDQUFDO0lBQ1gsTUFBTSxHQUFHLENBQUMsQ0FBQztJQUVuQixZQUFhLGFBQWlFLEVBQUUsYUFBcUIsRUFBRSxFQUFFLFVBQVUsR0FBRyxJQUFJLFVBQVUsRUFBRSxFQUFFLEtBQUssR0FBRyxJQUFJLFVBQVUsRUFBRTtRQUMvSixJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQztRQUNuQyxJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQztRQUM3QixJQUFJLENBQUMsVUFBVSxHQUFHLFVBQVUsQ0FBQztRQUM3QixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQztJQUNwQixDQUFDO0lBRU8sS0FBSyxDQUFFLElBQVk7UUFDMUIsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ2QsT0FBTyxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQztJQUMvQixDQUFDO0lBRU8sT0FBTyxDQUFFLFFBQTJDLEVBQUUsSUFBWSxFQUFFLEtBQVU7UUFDckYsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ2QsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ2QsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsS0FBSyxDQUFDO1FBQ2hDLElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQzdFLElBQUksUUFBUTtZQUFFLFFBQVEsQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDckMsQ0FBQztJQUVPLEtBQUssQ0FBRSxRQUFpRCxFQUFFLElBQVksRUFBRSxPQUFlO1FBQzlGLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUNkLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUNkLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsT0FBTyxDQUFDO1FBQzVCLElBQUksUUFBUTtZQUFFLFFBQVEsQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDdkMsQ0FBQztJQUVELE9BQU87UUFDTixJQUFJLE9BQU8sR0FBRyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQWlELEVBQUUsTUFBMkMsRUFBRSxFQUFFO1lBQzVILElBQUksS0FBSyxHQUFHLEdBQUcsRUFBRTtnQkFDaEIsSUFBSSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsRUFBRSxDQUFDO29CQUM5QixJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUU7d0JBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQzs7d0JBQ3JDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztvQkFDbkIsT0FBTztnQkFDUixDQUFDO2dCQUNELHFCQUFxQixDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQzlCLENBQUMsQ0FBQTtZQUNELHFCQUFxQixDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzlCLENBQUMsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxPQUFPLENBQUM7SUFDaEIsQ0FBQztJQUVELGFBQWEsQ0FBRSxJQUFZLEVBQUUsSUFBWTtRQUN4QyxJQUFJLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQztJQUM1RCxDQUFDO0lBRUQsVUFBVSxDQUFFLElBQVksRUFDdkIsVUFBc0QsR0FBRyxFQUFFLEdBQUcsQ0FBQyxFQUMvRCxRQUFpRCxHQUFHLEVBQUUsR0FBRyxDQUFDO1FBQzFELElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRXhCLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLEtBQUssQ0FBQztZQUFFLE9BQU87UUFFbkQsSUFBSSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxPQUFPLENBQU0sQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDcEUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBZ0IsRUFBUSxFQUFFO2dCQUMvRCxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUM7Z0JBQ2xDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNmLENBQUMsRUFBRSxDQUFDLE1BQWMsRUFBRSxZQUFvQixFQUFRLEVBQUU7Z0JBQ2pELE1BQU0sUUFBUSxHQUFHLHdCQUF3QixJQUFJLFlBQVksTUFBTSxLQUFLLFlBQVksRUFBRSxDQUFDO2dCQUNuRixJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLENBQUM7Z0JBQ2xDLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUNsQixDQUFDLENBQUMsQ0FBQztRQUNKLENBQUMsQ0FBQyxDQUFDO0lBQ0osQ0FBQztJQUVELFFBQVEsQ0FBRSxJQUFZLEVBQ3JCLFVBQWdELEdBQUcsRUFBRSxHQUFHLENBQUMsRUFDekQsUUFBaUQsR0FBRyxFQUFFLEdBQUcsQ0FBQztRQUMxRCxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUV4QixJQUFJLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFZLEVBQVEsRUFBRTtZQUN6RCxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDbkMsQ0FBQyxFQUFFLENBQUMsTUFBYyxFQUFFLFlBQW9CLEVBQVEsRUFBRTtZQUNqRCxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsc0JBQXNCLElBQUksWUFBWSxNQUFNLEtBQUssWUFBWSxFQUFFLENBQUMsQ0FBQztRQUMxRixDQUFDLENBQUMsQ0FBQztJQUNKLENBQUM7SUFFRCxRQUFRLENBQUUsSUFBWSxFQUNyQixVQUFrRCxHQUFHLEVBQUUsR0FBRyxDQUFDLEVBQzNELFFBQWlELEdBQUcsRUFBRSxHQUFHLENBQUM7UUFDMUQsSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFeEIsSUFBSSxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDO1lBQUUsT0FBTztRQUVuRCxJQUFJLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFJLE9BQU8sQ0FBTSxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUNwRSxJQUFJLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxJQUFZLEVBQVEsRUFBRTtnQkFDekQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO2dCQUNsQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDZixDQUFDLEVBQUUsQ0FBQyxNQUFjLEVBQUUsWUFBb0IsRUFBUSxFQUFFO2dCQUNqRCxNQUFNLFFBQVEsR0FBRyxzQkFBc0IsSUFBSSxZQUFZLE1BQU0sS0FBSyxZQUFZLEVBQUUsQ0FBQztnQkFDakYsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDO2dCQUNsQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDbEIsQ0FBQyxDQUFDLENBQUM7UUFDSixDQUFDLENBQUMsQ0FBQztJQUNKLENBQUM7SUFFRCxXQUFXLENBQUUsSUFBWSxFQUN4QixVQUE2QyxHQUFHLEVBQUUsR0FBRyxDQUFDLEVBQ3RELFFBQWlELEdBQUcsRUFBRSxHQUFHLENBQUM7UUFDMUQsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDbkQsTUFBTSxzQkFBc0IsR0FBRyxZQUFZLEtBQUssU0FBUyxDQUFDO1FBQzFELElBQUksc0JBQXNCLEVBQUUsQ0FBQztZQUM1QixJQUFJLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsR0FBRyxZQUFZO2lCQUMxQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUU7Z0JBQ1osd0RBQXdEO2dCQUN4RCx5RkFBeUY7Z0JBQ3pGLElBQUksR0FBRyxDQUFDLElBQUksWUFBWSxLQUFLLElBQUksSUFBSSxZQUFZLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7Z0JBQ2hHLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztnQkFDbEMsT0FBTyxJQUFJLENBQUM7WUFDYixDQUFDLENBQUM7aUJBQ0QsS0FBSyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUM7UUFDeEQsQ0FBQztRQUNELE9BQU8sc0JBQXNCLENBQUM7SUFDL0IsQ0FBQztJQUVELFdBQVcsQ0FBRSxJQUFZLEVBQ3hCLFVBQW9ELEdBQUcsRUFBRSxHQUFHLENBQUMsRUFDN0QsUUFBaUQsR0FBRyxFQUFFLEdBQUcsQ0FBQztRQUUxRCxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUV4QixJQUFJLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxLQUFLLENBQUM7WUFBRSxPQUFPO1FBRW5ELElBQUksQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksT0FBTyxDQUFNLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQ3BFLElBQUksU0FBUyxHQUFHLENBQUMsQ0FBQyxDQUFDLE9BQU8sTUFBTSxLQUFLLFdBQVcsSUFBSSxPQUFPLFNBQVMsS0FBSyxXQUFXLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ3pHLElBQUksV0FBVyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUMsMkNBQTJDO1lBQ3pFLElBQUksV0FBVyxFQUFFLENBQUM7Z0JBQ2pCLEtBQUssQ0FBQyxJQUFJLEVBQUUsRUFBRSxJQUFJLEVBQWUsTUFBTSxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxRQUFRLEVBQUUsRUFBRTtvQkFDNUQsSUFBSSxRQUFRLENBQUMsRUFBRTt3QkFBRSxPQUFPLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQztvQkFDeEMsTUFBTSxRQUFRLEdBQUcsd0JBQXdCLElBQUksRUFBRSxDQUFDO29CQUNoRCxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsd0JBQXdCLElBQUksRUFBRSxDQUFDLENBQUM7b0JBQ3hELE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQztnQkFDbEIsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUU7b0JBQ2hCLE9BQU8sSUFBSSxDQUFDLENBQUMsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLEVBQUUsRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLEVBQUUsb0JBQW9CLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO2dCQUMxRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRTtvQkFDbEIsSUFBSSxNQUFNLEVBQUUsQ0FBQzt3QkFDWixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQzt3QkFDakQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO3dCQUNyQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUM7b0JBQ2xCLENBQUM7b0JBQUEsQ0FBQztnQkFDSCxDQUFDLENBQUMsQ0FBQztZQUNKLENBQUM7aUJBQU0sQ0FBQztnQkFDUCxJQUFJLEtBQUssR0FBRyxJQUFJLEtBQUssRUFBRSxDQUFDO2dCQUN4QixLQUFLLENBQUMsV0FBVyxHQUFHLFdBQVcsQ0FBQztnQkFDaEMsS0FBSyxDQUFDLE1BQU0sR0FBRyxHQUFHLEVBQUU7b0JBQ25CLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDO29CQUNoRCxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7b0JBQ3JDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztnQkFDbEIsQ0FBQyxDQUFDO2dCQUNGLEtBQUssQ0FBQyxPQUFPLEdBQUcsR0FBRyxFQUFFO29CQUNwQixNQUFNLFFBQVEsR0FBRyx3QkFBd0IsSUFBSSxFQUFFLENBQUM7b0JBQ2hELElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsQ0FBQztvQkFDbEMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDO2dCQUNsQixDQUFDLENBQUM7Z0JBQ0YsSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7b0JBQUUsSUFBSSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUNoRixLQUFLLENBQUMsR0FBRyxHQUFHLElBQUksQ0FBQztZQUNsQixDQUFDO1FBQ0YsQ0FBQyxDQUFDLENBQUM7SUFDSixDQUFDO0lBRUQsZ0JBQWdCLENBQUUsSUFBWSxFQUM3QixVQUF1RCxHQUFHLEVBQUUsR0FBRyxDQUFDLEVBQ2hFLFFBQWlELEdBQUcsRUFBRSxHQUFHLENBQUMsRUFDMUQsU0FBeUM7UUFFekMsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNsQyxJQUFJLE1BQU0sR0FBRyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUM1RCxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUV4QixJQUFJLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxLQUFLLENBQUM7WUFBRSxPQUFPO1FBRW5ELElBQUksQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksT0FBTyxDQUFNLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQ3BFLElBQUksQ0FBQyxVQUFVLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxDQUFDLFNBQWlCLEVBQVEsRUFBRTtnQkFDOUQsSUFBSSxDQUFDO29CQUNKLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDLENBQUM7b0JBQ3ZELElBQUksTUFBTSxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLEtBQUssR0FBRyxLQUFLLENBQUM7b0JBQy9DLEtBQUssSUFBSSxJQUFJLElBQUksS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDO3dCQUM5QixJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFLLENBQUMsRUFDdkUsQ0FBQyxTQUFpQixFQUFFLE9BQWdCLEVBQUUsRUFBRTs0QkFDdkMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO2dDQUNaLElBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLENBQUM7Z0NBQ3pCLElBQUksRUFBRSxNQUFNLElBQUksQ0FBQyxFQUFFLENBQUM7b0NBQ25CLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztvQ0FDbkMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO2dDQUNoQixDQUFDOzRCQUNGLENBQUM7d0JBQ0YsQ0FBQyxFQUNELENBQUMsU0FBaUIsRUFBRSxPQUFlLEVBQUUsRUFBRTs0QkFDdEMsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO2dDQUNaLE1BQU0sUUFBUSxHQUFHLHlCQUF5QixJQUFJLGdCQUFnQixTQUFTLEVBQUUsQ0FBQztnQ0FDMUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDO2dDQUNsQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7NEJBQ2xCLENBQUM7NEJBQ0QsS0FBSyxHQUFHLElBQUksQ0FBQzt3QkFDZCxDQUFDLENBQ0QsQ0FBQztvQkFDSCxDQUFDO2dCQUNGLENBQUM7Z0JBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztvQkFDWixNQUFNLFFBQVEsR0FBRyxnQ0FBZ0MsSUFBSSxLQUFNLENBQVMsQ0FBQyxPQUFPLEVBQUUsQ0FBQztvQkFDL0UsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDO29CQUNsQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7Z0JBQ2xCLENBQUM7WUFDRixDQUFDLEVBQUUsQ0FBQyxNQUFjLEVBQUUsWUFBb0IsRUFBUSxFQUFFO2dCQUNqRCxNQUFNLFFBQVEsR0FBRywrQkFBK0IsSUFBSSxZQUFZLE1BQU0sS0FBSyxZQUFZLEVBQUUsQ0FBQztnQkFDMUYsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDO2dCQUNsQyxNQUFNLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDbEIsQ0FBQyxDQUFDLENBQUM7UUFDSixDQUFDLENBQUMsQ0FBQztJQUNKLENBQUM7SUFFRCw2QkFBNkIsQ0FBRSxJQUFZLEVBQzFDLFVBQXVELEdBQUcsRUFBRSxHQUFHLENBQUMsRUFDaEUsUUFBaUQsR0FBRyxFQUFFLEdBQUcsQ0FBQyxFQUMxRCxTQUF5QztRQUV6QyxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUV4QixJQUFJLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxLQUFLLENBQUM7WUFBRSxPQUFPO1FBRW5ELElBQUksQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksT0FBTyxDQUFNLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQ3BFLElBQUksQ0FBQyxVQUFVLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxDQUFDLFNBQWlCLEVBQVEsRUFBRTtnQkFDOUQsSUFBSSxDQUFDO29CQUNKLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDLENBQUM7b0JBQ3ZELElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztvQkFDbkMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUNoQixDQUFDO2dCQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7b0JBQ1osTUFBTSxRQUFRLEdBQUcsZ0NBQWdDLElBQUksS0FBTSxDQUFTLENBQUMsT0FBTyxFQUFFLENBQUM7b0JBQy9FLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsQ0FBQztvQkFDbEMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDO2dCQUNsQixDQUFDO1lBQ0YsQ0FBQyxFQUFFLENBQUMsTUFBYyxFQUFFLFlBQW9CLEVBQVEsRUFBRTtnQkFDakQsTUFBTSxRQUFRLEdBQUcsK0JBQStCLElBQUksWUFBWSxNQUFNLEtBQUssWUFBWSxFQUFFLENBQUM7Z0JBQzFGLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsQ0FBQztnQkFDbEMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ2xCLENBQUMsQ0FBQyxDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7SUFDSixDQUFDO0lBRUQsd0NBQXdDO0lBQ3hDLEtBQUssQ0FBQyxlQUFlLENBQUUsSUFBWTtRQUNsQyxPQUFPLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQ3RDLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUNuQixDQUFDLENBQUMsRUFBRSxNQUFNLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFDOUIsQ0FBQyxDQUFDLEVBQUUsT0FBTyxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQy9CLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztJQUNKLENBQUM7SUFFRCxLQUFLLENBQUMsYUFBYSxDQUFFLElBQVk7UUFDaEMsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUN0QyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFDakIsQ0FBQyxDQUFDLEVBQUUsTUFBTSxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLEVBQzlCLENBQUMsQ0FBQyxFQUFFLE9BQU8sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUMvQixDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUM7SUFDSixDQUFDO0lBRUQsS0FBSyxDQUFDLGdCQUFnQixDQUFFLElBQVk7UUFDbkMsT0FBTyxJQUFJLE9BQU8sQ0FBVSxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUMvQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksRUFDcEIsQ0FBQyxDQUFDLEVBQUUsT0FBTyxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQ2hDLENBQUMsQ0FBQyxFQUFFLE9BQU8sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUMvQixDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUM7SUFDSixDQUFDO0lBRUQsS0FBSyxDQUFDLHFCQUFxQixDQUFFLElBQVk7UUFDeEMsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUN0QyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxFQUN6QixDQUFDLENBQUMsRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFDNUIsQ0FBQyxDQUFDLEVBQUUsT0FBTyxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQy9CLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztJQUNKLENBQUM7SUFFRCxLQUFLLENBQUMsa0NBQWtDLENBQUUsSUFBWTtRQUNyRCxPQUFPLElBQUksT0FBTyxDQUFlLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQ3BELElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxJQUFJLEVBQ3RDLENBQUMsQ0FBQyxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUM1QixDQUFDLENBQUMsRUFBRSxPQUFPLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FDL0IsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO0lBQ0osQ0FBQztJQUVELFFBQVEsQ0FBRSxLQUFpQjtRQUMxQixJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQztJQUNwQixDQUFDO0lBRUQsR0FBRyxDQUFFLElBQVk7UUFDaEIsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxDQUFDO0lBQ2xELENBQUM7SUFFRCxPQUFPLENBQUUsSUFBWTtRQUNwQixJQUFJLEdBQUcsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUM7UUFDOUIsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDcEMsSUFBSSxLQUFLO1lBQUUsT0FBTyxLQUFLLENBQUM7UUFDeEIsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUM5QixNQUFNLEtBQUssQ0FBQyxtQkFBbUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFDdkUsQ0FBQztJQUVELE1BQU0sQ0FBRSxJQUFZO1FBQ25CLElBQUksR0FBRyxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQztRQUM5QixJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNwQyxJQUFJLEtBQUssQ0FBQyxPQUFPO1lBQUUsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ25DLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDL0IsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN2QyxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3JDLE9BQU8sS0FBSyxDQUFDO0lBQ2QsQ0FBQztJQUVELFNBQVM7UUFDUixLQUFLLElBQUksSUFBSSxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDcEMsSUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDcEMsSUFBSSxLQUFLLENBQUMsT0FBTztnQkFBRSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDcEMsQ0FBQztRQUNELElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQztRQUN2QixJQUFJLENBQUMsS0FBSyxDQUFDLFlBQVksR0FBRyxFQUFFLENBQUM7UUFDN0IsSUFBSSxDQUFDLEtBQUssQ0FBQyxjQUFjLEdBQUcsRUFBRSxDQUFDO0lBQ2hDLENBQUM7SUFFRCxpQkFBaUI7UUFDaEIsT0FBTyxJQUFJLENBQUMsTUFBTSxJQUFJLENBQUMsQ0FBQztJQUN6QixDQUFDO0lBRUQsU0FBUztRQUNSLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQztJQUNwQixDQUFDO0lBRUQsU0FBUztRQUNSLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQztJQUNwQixDQUFDO0lBRUQsT0FBTztRQUNOLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztJQUNsQixDQUFDO0lBRUQsZ0RBQWdEO0lBQ2hELFlBQVksQ0FBRSxJQUFZO1FBQ3pCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3RDLElBQUksS0FBSyxZQUFZLFlBQVksRUFBRSxDQUFDO1lBQ25DLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNoQixPQUFPO1FBQ1IsQ0FBQztRQUNELElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBRUQsU0FBUztRQUNSLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQztJQUM1QyxDQUFDO0lBRUQsU0FBUztRQUNSLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQztJQUNwQixDQUFDO0lBRU8sb0JBQW9CLENBQUUsSUFBWTtRQUN6QyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3BGLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUMxQixDQUFDO0lBQ0YsQ0FBQztJQUVPLGtCQUFrQixDQUFFLElBQVksRUFBRSxTQUFpQjtRQUMxRCxNQUFNLEtBQUssR0FBRyxJQUFJLFlBQVksQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUMxQyxLQUFLLENBQUMsT0FBTyxHQUFHLEdBQUcsRUFBRTtZQUNwQixJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7Z0JBQUUsT0FBTztZQUNqRCxJQUFJLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDaEMsS0FBSyxNQUFNLElBQUksSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUM7Z0JBQ2hDLElBQUksQ0FBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUM7WUFDekIsQ0FBQztRQUNGLENBQUMsQ0FBQTtRQUNELE9BQU8sS0FBSyxDQUFDO0lBQ2QsQ0FBQztJQUVPLGFBQWEsQ0FBRSxJQUFZLEVBQUUsS0FBcUM7UUFDekUsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUMxQyxNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUNyRCxPQUFPLENBQUMsT0FBTyxHQUFHLEdBQUcsRUFBRTtZQUN0QixJQUFJLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLENBQUM7Z0JBQUUsY0FBYyxFQUFFLENBQUM7UUFDdkQsQ0FBQyxDQUFBO1FBQ0QsT0FBTyxPQUFPLENBQUM7SUFDaEIsQ0FBQztDQUNEO0FBRUQsTUFBTSxPQUFPLFVBQVU7SUFDZixNQUFNLEdBQW1CLEVBQUUsQ0FBQztJQUM1QixjQUFjLEdBQXNCLEVBQUUsQ0FBQztJQUN2QyxZQUFZLEdBQTRCLEVBQUUsQ0FBQztJQUVsRCxNQUFNLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxHQUFHLEVBQXNCLENBQUM7SUFDeEQsTUFBTSxDQUFDLFFBQVEsQ0FBRSxFQUFVO1FBQzFCLE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDbEQsSUFBSSxLQUFLO1lBQUUsT0FBTyxLQUFLLENBQUM7UUFFeEIsTUFBTSxRQUFRLEdBQUcsSUFBSSxVQUFVLEVBQUUsQ0FBQztRQUNsQyxVQUFVLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFBRSxRQUFRLENBQUMsQ0FBQztRQUM5QyxPQUFPLFFBQVEsQ0FBQztJQUNqQixDQUFDO0lBRUQsS0FBSyxDQUFDLFFBQVEsQ0FBRSxJQUFZLEVBQUUsS0FBVTtRQUN2QyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDakQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxNQUFNLEtBQUssQ0FBQztJQUNqQyxDQUFDOztBQUdGLE1BQU0sT0FBTyxVQUFVO0lBQ2QsU0FBUyxHQUErQixFQUFFLENBQUM7SUFDbkQsV0FBVyxHQUFzQixFQUFFLENBQUM7SUFFcEMsZUFBZSxDQUFFLE9BQWU7UUFDL0IsSUFBSSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNsQyxNQUFNLElBQUksS0FBSyxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFDcEMsQ0FBQztRQUVELElBQUksU0FBUyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDM0MsSUFBSSxTQUFTLElBQUksQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUNyQixTQUFTLElBQUksU0FBUyxDQUFDLE1BQU0sQ0FBQztZQUM5QixPQUFPLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7UUFDeEMsQ0FBQzthQUFNLENBQUM7WUFDUCxPQUFPLE9BQU8sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNqRCxDQUFDO0lBQ0YsQ0FBQztJQUVELGtCQUFrQixDQUFFLE1BQWM7UUFDakMsSUFBSSxhQUFhLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUN4QyxJQUFJLEdBQUcsR0FBRyxhQUFhLENBQUMsTUFBTSxDQUFDO1FBQy9CLElBQUksS0FBSyxHQUFHLElBQUksVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2hDLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztZQUM5QixLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUN4QyxDQUFDO1FBQ0QsT0FBTyxLQUFLLENBQUM7SUFDZCxDQUFDO0lBRUQsbUJBQW1CLENBQUUsT0FBZTtRQUNuQyxJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ2xDLE1BQU0sSUFBSSxLQUFLLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUNwQyxDQUFDO1FBRUQsSUFBSSxTQUFTLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUMzQyxJQUFJLFNBQVMsSUFBSSxDQUFDLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUM7UUFDL0QsU0FBUyxJQUFJLFNBQVMsQ0FBQyxNQUFNLENBQUM7UUFDOUIsT0FBTyxJQUFJLENBQUMsa0JBQWtCLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO0lBQzNELENBQUM7SUFFRCxZQUFZLENBQUUsR0FBVyxFQUFFLE9BQStCLEVBQUUsS0FBcUQ7UUFDaEgsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDO1lBQUUsT0FBTztRQUU1QyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3pDLHVGQUF1RjtRQUN2RixJQUFJLFVBQVUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUM3QyxJQUFJLENBQUM7Z0JBQ0osSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLElBQUksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQztZQUN6RCxDQUFDO1lBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztnQkFDWixJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzFDLENBQUM7WUFDRCxPQUFPO1FBQ1IsQ0FBQztRQUVELElBQUksT0FBTyxHQUFHLElBQUksY0FBYyxFQUFFLENBQUM7UUFDbkMsT0FBTyxDQUFDLGdCQUFnQixDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBQ3RDLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLFVBQVUsQ0FBQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDekQsSUFBSSxJQUFJLEdBQUcsR0FBRyxFQUFFO1lBQ2YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEVBQUUsT0FBTyxDQUFDLE1BQU0sRUFBRSxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDeEQsQ0FBQyxDQUFDO1FBQ0YsT0FBTyxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUM7UUFDdEIsT0FBTyxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUM7UUFDdkIsT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDO0lBQ2hCLENBQUM7SUFFRCxZQUFZLENBQUUsR0FBVyxFQUFFLE9BQStCLEVBQUUsS0FBcUQ7UUFDaEgsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFZLEVBQVEsRUFBRTtZQUM3QyxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQzNCLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQztJQUNYLENBQUM7SUFFRCxjQUFjLENBQUUsR0FBVyxFQUFFLE9BQW1DLEVBQUUsS0FBcUQ7UUFDdEgsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDO1lBQUUsT0FBTztRQUU1QyxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ3pDLHVGQUF1RjtRQUN2RixJQUFJLFVBQVUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUM3QyxJQUFJLENBQUM7Z0JBQ0osSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDO1lBQzdELENBQUM7WUFBQyxPQUFPLENBQUMsRUFBRSxDQUFDO2dCQUNaLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDMUMsQ0FBQztZQUNELE9BQU87UUFDUixDQUFDO1FBRUQsSUFBSSxPQUFPLEdBQUcsSUFBSSxjQUFjLEVBQUUsQ0FBQztRQUNuQyxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRSxVQUFVLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ3pELE9BQU8sQ0FBQyxZQUFZLEdBQUcsYUFBYSxDQUFDO1FBQ3JDLElBQUksT0FBTyxHQUFHLEdBQUcsRUFBRTtZQUNsQixJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsRUFBRSxPQUFPLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNwRCxDQUFDLENBQUM7UUFDRixPQUFPLENBQUMsTUFBTSxHQUFHLEdBQUcsRUFBRTtZQUNyQixJQUFJLE9BQU8sQ0FBQyxNQUFNLElBQUksR0FBRyxJQUFJLE9BQU8sQ0FBQyxNQUFNLElBQUksQ0FBQztnQkFDL0MsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLElBQUksVUFBVSxDQUFDLE9BQU8sQ0FBQyxRQUF1QixDQUFDLENBQUMsQ0FBQzs7Z0JBRXZFLE9BQU8sRUFBRSxDQUFDO1FBQ1osQ0FBQyxDQUFDO1FBQ0YsT0FBTyxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDMUIsT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDO0lBQ2hCLENBQUM7SUFFTyxLQUFLLENBQUUsR0FBVyxFQUFFLE9BQVksRUFBRSxLQUFVO1FBQ25ELElBQUksU0FBUyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDcEMsSUFBSSxDQUFDO1lBQ0osSUFBSSxTQUFTO2dCQUFFLE9BQU8sSUFBSSxDQUFDO1lBQzNCLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLEdBQUcsU0FBUyxHQUFHLEVBQUUsQ0FBQztRQUN0QyxDQUFDO2dCQUFTLENBQUM7WUFDVixTQUFTLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNoQyxDQUFDO0lBQ0YsQ0FBQztJQUVPLE1BQU0sQ0FBRSxHQUFXLEVBQUUsTUFBYyxFQUFFLElBQVM7UUFDckQsSUFBSSxTQUFTLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNwQyxPQUFPLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDM0IsSUFBSSxJQUFJLEdBQUcsTUFBTSxJQUFJLEdBQUcsSUFBSSxNQUFNLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztRQUNsRSxLQUFLLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxTQUFTLENBQUMsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUM7WUFDaEUsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDakMsQ0FBQztDQUNEIiwic291cmNlc0NvbnRlbnQiOlsiLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICogU3BpbmUgUnVudGltZXMgTGljZW5zZSBBZ3JlZW1lbnRcbiAqIExhc3QgdXBkYXRlZCBBcHJpbCA1LCAyMDI1LiBSZXBsYWNlcyBhbGwgcHJpb3IgdmVyc2lvbnMuXG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDEzLTIwMjUsIEVzb3RlcmljIFNvZnR3YXJlIExMQ1xuICpcbiAqIEludGVncmF0aW9uIG9mIHRoZSBTcGluZSBSdW50aW1lcyBpbnRvIHNvZnR3YXJlIG9yIG90aGVyd2lzZSBjcmVhdGluZ1xuICogZGVyaXZhdGl2ZSB3b3JrcyBvZiB0aGUgU3BpbmUgUnVudGltZXMgaXMgcGVybWl0dGVkIHVuZGVyIHRoZSB0ZXJtcyBhbmRcbiAqIGNvbmRpdGlvbnMgb2YgU2VjdGlvbiAyIG9mIHRoZSBTcGluZSBFZGl0b3IgTGljZW5zZSBBZ3JlZW1lbnQ6XG4gKiBodHRwOi8vZXNvdGVyaWNzb2Z0d2FyZS5jb20vc3BpbmUtZWRpdG9yLWxpY2Vuc2VcbiAqXG4gKiBPdGhlcndpc2UsIGl0IGlzIHBlcm1pdHRlZCB0byBpbnRlZ3JhdGUgdGhlIFNwaW5lIFJ1bnRpbWVzIGludG8gc29mdHdhcmVcbiAqIG9yIG90aGVyd2lzZSBjcmVhdGUgZGVyaXZhdGl2ZSB3b3JrcyBvZiB0aGUgU3BpbmUgUnVudGltZXMgKGNvbGxlY3RpdmVseSxcbiAqIFwiUHJvZHVjdHNcIiksIHByb3ZpZGVkIHRoYXQgZWFjaCB1c2VyIG9mIHRoZSBQcm9kdWN0cyBtdXN0IG9idGFpbiB0aGVpciBvd25cbiAqIFNwaW5lIEVkaXRvciBsaWNlbnNlIGFuZCByZWRpc3RyaWJ1dGlvbiBvZiB0aGUgUHJvZHVjdHMgaW4gYW55IGZvcm0gbXVzdFxuICogaW5jbHVkZSB0aGlzIGxpY2Vuc2UgYW5kIGNvcHlyaWdodCBub3RpY2UuXG4gKlxuICogVEhFIFNQSU5FIFJVTlRJTUVTIEFSRSBQUk9WSURFRCBCWSBFU09URVJJQyBTT0ZUV0FSRSBMTEMgXCJBUyBJU1wiIEFORCBBTllcbiAqIEVYUFJFU1MgT1IgSU1QTElFRCBXQVJSQU5USUVTLCBJTkNMVURJTkcsIEJVVCBOT1QgTElNSVRFRCBUTywgVEhFIElNUExJRURcbiAqIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZIEFORCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBUkVcbiAqIERJU0NMQUlNRUQuIElOIE5PIEVWRU5UIFNIQUxMIEVTT1RFUklDIFNPRlRXQVJFIExMQyBCRSBMSUFCTEUgRk9SIEFOWVxuICogRElSRUNULCBJTkRJUkVDVCwgSU5DSURFTlRBTCwgU1BFQ0lBTCwgRVhFTVBMQVJZLCBPUiBDT05TRVFVRU5USUFMIERBTUFHRVNcbiAqIChJTkNMVURJTkcsIEJVVCBOT1QgTElNSVRFRCBUTywgUFJPQ1VSRU1FTlQgT0YgU1VCU1RJVFVURSBHT09EUyBPUiBTRVJWSUNFUyxcbiAqIEJVU0lORVNTIElOVEVSUlVQVElPTiwgT1IgTE9TUyBPRiBVU0UsIERBVEEsIE9SIFBST0ZJVFMpIEhPV0VWRVIgQ0FVU0VEIEFORFxuICogT04gQU5ZIFRIRU9SWSBPRiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQ09OVFJBQ1QsIFNUUklDVCBMSUFCSUxJVFksIE9SIFRPUlRcbiAqIChJTkNMVURJTkcgTkVHTElHRU5DRSBPUiBPVEhFUldJU0UpIEFSSVNJTkcgSU4gQU5ZIFdBWSBPVVQgT0YgVEhFIFVTRSBPRlxuICogVEhFIFNQSU5FIFJVTlRJTUVTLCBFVkVOIElGIEFEVklTRUQgT0YgVEhFIFBPU1NJQklMSVRZIE9GIFNVQ0ggREFNQUdFLlxuICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG5pbXBvcnQgeyBUZXh0dXJlIH0gZnJvbSBcIi4vVGV4dHVyZS5qc1wiO1xuaW1wb3J0IHsgVGV4dHVyZUF0bGFzIH0gZnJvbSBcIi4vVGV4dHVyZUF0bGFzLmpzXCI7XG5pbXBvcnQgeyBEaXNwb3NhYmxlLCBTdHJpbmdNYXAgfSBmcm9tIFwiLi9VdGlscy5qc1wiO1xuXG5leHBvcnQgY2xhc3MgQXNzZXRNYW5hZ2VyQmFzZSBpbXBsZW1lbnRzIERpc3Bvc2FibGUge1xuXHRwcml2YXRlIHBhdGhQcmVmaXg6IHN0cmluZyA9IFwiXCI7XG5cdHByaXZhdGUgdGV4dHVyZUxvYWRlcjogKGltYWdlOiBIVE1MSW1hZ2VFbGVtZW50IHwgSW1hZ2VCaXRtYXApID0+IFRleHR1cmU7XG5cdHByaXZhdGUgZG93bmxvYWRlcjogRG93bmxvYWRlcjtcblx0cHJpdmF0ZSBjYWNoZTogQXNzZXRDYWNoZTtcblx0cHJpdmF0ZSBlcnJvcnM6IFN0cmluZ01hcDxzdHJpbmc+ID0ge307XG5cdHByaXZhdGUgdG9Mb2FkID0gMDtcblx0cHJpdmF0ZSBsb2FkZWQgPSAwO1xuXG5cdGNvbnN0cnVjdG9yICh0ZXh0dXJlTG9hZGVyOiAoaW1hZ2U6IEhUTUxJbWFnZUVsZW1lbnQgfCBJbWFnZUJpdG1hcCkgPT4gVGV4dHVyZSwgcGF0aFByZWZpeDogc3RyaW5nID0gXCJcIiwgZG93bmxvYWRlciA9IG5ldyBEb3dubG9hZGVyKCksIGNhY2hlID0gbmV3IEFzc2V0Q2FjaGUoKSkge1xuXHRcdHRoaXMudGV4dHVyZUxvYWRlciA9IHRleHR1cmVMb2FkZXI7XG5cdFx0dGhpcy5wYXRoUHJlZml4ID0gcGF0aFByZWZpeDtcblx0XHR0aGlzLmRvd25sb2FkZXIgPSBkb3dubG9hZGVyO1xuXHRcdHRoaXMuY2FjaGUgPSBjYWNoZTtcblx0fVxuXG5cdHByaXZhdGUgc3RhcnQgKHBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG5cdFx0dGhpcy50b0xvYWQrKztcblx0XHRyZXR1cm4gdGhpcy5wYXRoUHJlZml4ICsgcGF0aDtcblx0fVxuXG5cdHByaXZhdGUgc3VjY2VzcyAoY2FsbGJhY2s6IChwYXRoOiBzdHJpbmcsIGRhdGE6IGFueSkgPT4gdm9pZCwgcGF0aDogc3RyaW5nLCBhc3NldDogYW55KSB7XG5cdFx0dGhpcy50b0xvYWQtLTtcblx0XHR0aGlzLmxvYWRlZCsrO1xuXHRcdHRoaXMuY2FjaGUuYXNzZXRzW3BhdGhdID0gYXNzZXQ7XG5cdFx0dGhpcy5jYWNoZS5hc3NldHNSZWZDb3VudFtwYXRoXSA9ICh0aGlzLmNhY2hlLmFzc2V0c1JlZkNvdW50W3BhdGhdIHx8IDApICsgMTtcblx0XHRpZiAoY2FsbGJhY2spIGNhbGxiYWNrKHBhdGgsIGFzc2V0KTtcblx0fVxuXG5cdHByaXZhdGUgZXJyb3IgKGNhbGxiYWNrOiAocGF0aDogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmcpID0+IHZvaWQsIHBhdGg6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nKSB7XG5cdFx0dGhpcy50b0xvYWQtLTtcblx0XHR0aGlzLmxvYWRlZCsrO1xuXHRcdHRoaXMuZXJyb3JzW3BhdGhdID0gbWVzc2FnZTtcblx0XHRpZiAoY2FsbGJhY2spIGNhbGxiYWNrKHBhdGgsIG1lc3NhZ2UpO1xuXHR9XG5cblx0bG9hZEFsbCAoKSB7XG5cdFx0bGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZTogKGFzc2V0TWFuYWdlcjogQXNzZXRNYW5hZ2VyQmFzZSkgPT4gdm9pZCwgcmVqZWN0OiAoZXJyb3JzOiBTdHJpbmdNYXA8c3RyaW5nPikgPT4gdm9pZCkgPT4ge1xuXHRcdFx0bGV0IGNoZWNrID0gKCkgPT4ge1xuXHRcdFx0XHRpZiAodGhpcy5pc0xvYWRpbmdDb21wbGV0ZSgpKSB7XG5cdFx0XHRcdFx0aWYgKHRoaXMuaGFzRXJyb3JzKCkpIHJlamVjdCh0aGlzLmVycm9ycyk7XG5cdFx0XHRcdFx0ZWxzZSByZXNvbHZlKHRoaXMpO1xuXHRcdFx0XHRcdHJldHVybjtcblx0XHRcdFx0fVxuXHRcdFx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoY2hlY2spO1xuXHRcdFx0fVxuXHRcdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKGNoZWNrKTtcblx0XHR9KTtcblx0XHRyZXR1cm4gcHJvbWlzZTtcblx0fVxuXG5cdHNldFJhd0RhdGFVUkkgKHBhdGg6IHN0cmluZywgZGF0YTogc3RyaW5nKSB7XG5cdFx0dGhpcy5kb3dubG9hZGVyLnJhd0RhdGFVcmlzW3RoaXMucGF0aFByZWZpeCArIHBhdGhdID0gZGF0YTtcblx0fVxuXG5cdGxvYWRCaW5hcnkgKHBhdGg6IHN0cmluZyxcblx0XHRzdWNjZXNzOiAocGF0aDogc3RyaW5nLCBiaW5hcnk6IFVpbnQ4QXJyYXkpID0+IHZvaWQgPSAoKSA9PiB7IH0sXG5cdFx0ZXJyb3I6IChwYXRoOiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZykgPT4gdm9pZCA9ICgpID0+IHsgfSkge1xuXHRcdHBhdGggPSB0aGlzLnN0YXJ0KHBhdGgpO1xuXG5cdFx0aWYgKHRoaXMucmV1c2VBc3NldHMocGF0aCwgc3VjY2VzcywgZXJyb3IpKSByZXR1cm47XG5cblx0XHR0aGlzLmNhY2hlLmFzc2V0c0xvYWRlZFtwYXRoXSA9IG5ldyBQcm9taXNlPGFueT4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuXHRcdFx0dGhpcy5kb3dubG9hZGVyLmRvd25sb2FkQmluYXJ5KHBhdGgsIChkYXRhOiBVaW50OEFycmF5KTogdm9pZCA9PiB7XG5cdFx0XHRcdHRoaXMuc3VjY2VzcyhzdWNjZXNzLCBwYXRoLCBkYXRhKTtcblx0XHRcdFx0cmVzb2x2ZShkYXRhKTtcblx0XHRcdH0sIChzdGF0dXM6IG51bWJlciwgcmVzcG9uc2VUZXh0OiBzdHJpbmcpOiB2b2lkID0+IHtcblx0XHRcdFx0Y29uc3QgZXJyb3JNc2cgPSBgQ291bGRuJ3QgbG9hZCBiaW5hcnkgJHtwYXRofTogc3RhdHVzICR7c3RhdHVzfSwgJHtyZXNwb25zZVRleHR9YDtcblx0XHRcdFx0dGhpcy5lcnJvcihlcnJvciwgcGF0aCwgZXJyb3JNc2cpO1xuXHRcdFx0XHRyZWplY3QoZXJyb3JNc2cpO1xuXHRcdFx0fSk7XG5cdFx0fSk7XG5cdH1cblxuXHRsb2FkVGV4dCAocGF0aDogc3RyaW5nLFxuXHRcdHN1Y2Nlc3M6IChwYXRoOiBzdHJpbmcsIHRleHQ6IHN0cmluZykgPT4gdm9pZCA9ICgpID0+IHsgfSxcblx0XHRlcnJvcjogKHBhdGg6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nKSA9PiB2b2lkID0gKCkgPT4geyB9KSB7XG5cdFx0cGF0aCA9IHRoaXMuc3RhcnQocGF0aCk7XG5cblx0XHR0aGlzLmRvd25sb2FkZXIuZG93bmxvYWRUZXh0KHBhdGgsIChkYXRhOiBzdHJpbmcpOiB2b2lkID0+IHtcblx0XHRcdHRoaXMuc3VjY2VzcyhzdWNjZXNzLCBwYXRoLCBkYXRhKTtcblx0XHR9LCAoc3RhdHVzOiBudW1iZXIsIHJlc3BvbnNlVGV4dDogc3RyaW5nKTogdm9pZCA9PiB7XG5cdFx0XHR0aGlzLmVycm9yKGVycm9yLCBwYXRoLCBgQ291bGRuJ3QgbG9hZCB0ZXh0ICR7cGF0aH06IHN0YXR1cyAke3N0YXR1c30sICR7cmVzcG9uc2VUZXh0fWApO1xuXHRcdH0pO1xuXHR9XG5cblx0bG9hZEpzb24gKHBhdGg6IHN0cmluZyxcblx0XHRzdWNjZXNzOiAocGF0aDogc3RyaW5nLCBvYmplY3Q6IG9iamVjdCkgPT4gdm9pZCA9ICgpID0+IHsgfSxcblx0XHRlcnJvcjogKHBhdGg6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nKSA9PiB2b2lkID0gKCkgPT4geyB9KSB7XG5cdFx0cGF0aCA9IHRoaXMuc3RhcnQocGF0aCk7XG5cblx0XHRpZiAodGhpcy5yZXVzZUFzc2V0cyhwYXRoLCBzdWNjZXNzLCBlcnJvcikpIHJldHVybjtcblxuXHRcdHRoaXMuY2FjaGUuYXNzZXRzTG9hZGVkW3BhdGhdID0gbmV3IFByb21pc2U8YW55PigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG5cdFx0XHR0aGlzLmRvd25sb2FkZXIuZG93bmxvYWRKc29uKHBhdGgsIChkYXRhOiBvYmplY3QpOiB2b2lkID0+IHtcblx0XHRcdFx0dGhpcy5zdWNjZXNzKHN1Y2Nlc3MsIHBhdGgsIGRhdGEpO1xuXHRcdFx0XHRyZXNvbHZlKGRhdGEpO1xuXHRcdFx0fSwgKHN0YXR1czogbnVtYmVyLCByZXNwb25zZVRleHQ6IHN0cmluZyk6IHZvaWQgPT4ge1xuXHRcdFx0XHRjb25zdCBlcnJvck1zZyA9IGBDb3VsZG4ndCBsb2FkIEpTT04gJHtwYXRofTogc3RhdHVzICR7c3RhdHVzfSwgJHtyZXNwb25zZVRleHR9YDtcblx0XHRcdFx0dGhpcy5lcnJvcihlcnJvciwgcGF0aCwgZXJyb3JNc2cpO1xuXHRcdFx0XHRyZWplY3QoZXJyb3JNc2cpO1xuXHRcdFx0fSk7XG5cdFx0fSk7XG5cdH1cblxuXHRyZXVzZUFzc2V0cyAocGF0aDogc3RyaW5nLFxuXHRcdHN1Y2Nlc3M6IChwYXRoOiBzdHJpbmcsIGRhdGE6IGFueSkgPT4gdm9pZCA9ICgpID0+IHsgfSxcblx0XHRlcnJvcjogKHBhdGg6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nKSA9PiB2b2lkID0gKCkgPT4geyB9KSB7XG5cdFx0Y29uc3QgbG9hZGVkU3RhdHVzID0gdGhpcy5jYWNoZS5hc3NldHNMb2FkZWRbcGF0aF07XG5cdFx0Y29uc3QgYWxyZWFkeUV4aXN0c09yTG9hZGluZyA9IGxvYWRlZFN0YXR1cyAhPT0gdW5kZWZpbmVkO1xuXHRcdGlmIChhbHJlYWR5RXhpc3RzT3JMb2FkaW5nKSB7XG5cdFx0XHR0aGlzLmNhY2hlLmFzc2V0c0xvYWRlZFtwYXRoXSA9IGxvYWRlZFN0YXR1c1xuXHRcdFx0XHQudGhlbihkYXRhID0+IHtcblx0XHRcdFx0XHQvLyBuZWNlc3Nhcnkgd2hlbiB1c2VyIHByZWxvYWRzIGFuIGltYWdlIGludG8gdGhlIGNhY2hlLlxuXHRcdFx0XHRcdC8vIHRleHR1cmUgbG9hZGVyIGlzIG5vdCBhdmFpYWJsZSBpbiB0aGUgY2FjaGUsIHNvIHdlIHRyYW5zZm9ybSBpbiBHTFRleHR1cmUgYXQgZmlyc3QgdXNlXG5cdFx0XHRcdFx0ZGF0YSA9IChkYXRhIGluc3RhbmNlb2YgSW1hZ2UgfHwgZGF0YSBpbnN0YW5jZW9mIEltYWdlQml0bWFwKSA/IHRoaXMudGV4dHVyZUxvYWRlcihkYXRhKSA6IGRhdGE7XG5cdFx0XHRcdFx0dGhpcy5zdWNjZXNzKHN1Y2Nlc3MsIHBhdGgsIGRhdGEpO1xuXHRcdFx0XHRcdHJldHVybiBkYXRhO1xuXHRcdFx0XHR9KVxuXHRcdFx0XHQuY2F0Y2goZXJyb3JNc2cgPT4gdGhpcy5lcnJvcihlcnJvciwgcGF0aCwgZXJyb3JNc2cpKTtcblx0XHR9XG5cdFx0cmV0dXJuIGFscmVhZHlFeGlzdHNPckxvYWRpbmc7XG5cdH1cblxuXHRsb2FkVGV4dHVyZSAocGF0aDogc3RyaW5nLFxuXHRcdHN1Y2Nlc3M6IChwYXRoOiBzdHJpbmcsIHRleHR1cmU6IFRleHR1cmUpID0+IHZvaWQgPSAoKSA9PiB7IH0sXG5cdFx0ZXJyb3I6IChwYXRoOiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZykgPT4gdm9pZCA9ICgpID0+IHsgfSkge1xuXG5cdFx0cGF0aCA9IHRoaXMuc3RhcnQocGF0aCk7XG5cblx0XHRpZiAodGhpcy5yZXVzZUFzc2V0cyhwYXRoLCBzdWNjZXNzLCBlcnJvcikpIHJldHVybjtcblxuXHRcdHRoaXMuY2FjaGUuYXNzZXRzTG9hZGVkW3BhdGhdID0gbmV3IFByb21pc2U8YW55PigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG5cdFx0XHRsZXQgaXNCcm93c2VyID0gISEodHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIG5hdmlnYXRvciAhPT0gJ3VuZGVmaW5lZCcgJiYgd2luZG93LmRvY3VtZW50KTtcblx0XHRcdGxldCBpc1dlYldvcmtlciA9ICFpc0Jyb3dzZXI7IC8vICYmIHR5cGVvZiBpbXBvcnRTY3JpcHRzICE9PSAndW5kZWZpbmVkJztcblx0XHRcdGlmIChpc1dlYldvcmtlcikge1xuXHRcdFx0XHRmZXRjaChwYXRoLCB7IG1vZGU6IDxSZXF1ZXN0TW9kZT5cImNvcnNcIiB9KS50aGVuKChyZXNwb25zZSkgPT4ge1xuXHRcdFx0XHRcdGlmIChyZXNwb25zZS5vaykgcmV0dXJuIHJlc3BvbnNlLmJsb2IoKTtcblx0XHRcdFx0XHRjb25zdCBlcnJvck1zZyA9IGBDb3VsZG4ndCBsb2FkIGltYWdlOiAke3BhdGh9YDtcblx0XHRcdFx0XHR0aGlzLmVycm9yKGVycm9yLCBwYXRoLCBgQ291bGRuJ3QgbG9hZCBpbWFnZTogJHtwYXRofWApO1xuXHRcdFx0XHRcdHJlamVjdChlcnJvck1zZyk7XG5cdFx0XHRcdH0pLnRoZW4oKGJsb2IpID0+IHtcblx0XHRcdFx0XHRyZXR1cm4gYmxvYiA/IGNyZWF0ZUltYWdlQml0bWFwKGJsb2IsIHsgcHJlbXVsdGlwbHlBbHBoYTogXCJub25lXCIsIGNvbG9yU3BhY2VDb252ZXJzaW9uOiBcIm5vbmVcIiB9KSA6IG51bGw7XG5cdFx0XHRcdH0pLnRoZW4oKGJpdG1hcCkgPT4ge1xuXHRcdFx0XHRcdGlmIChiaXRtYXApIHtcblx0XHRcdFx0XHRcdGNvbnN0IHRleHR1cmUgPSB0aGlzLmNyZWF0ZVRleHR1cmUocGF0aCwgYml0bWFwKTtcblx0XHRcdFx0XHRcdHRoaXMuc3VjY2VzcyhzdWNjZXNzLCBwYXRoLCB0ZXh0dXJlKTtcblx0XHRcdFx0XHRcdHJlc29sdmUodGV4dHVyZSk7XG5cdFx0XHRcdFx0fTtcblx0XHRcdFx0fSk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRsZXQgaW1hZ2UgPSBuZXcgSW1hZ2UoKTtcblx0XHRcdFx0aW1hZ2UuY3Jvc3NPcmlnaW4gPSBcImFub255bW91c1wiO1xuXHRcdFx0XHRpbWFnZS5vbmxvYWQgPSAoKSA9PiB7XG5cdFx0XHRcdFx0Y29uc3QgdGV4dHVyZSA9IHRoaXMuY3JlYXRlVGV4dHVyZShwYXRoLCBpbWFnZSk7XG5cdFx0XHRcdFx0dGhpcy5zdWNjZXNzKHN1Y2Nlc3MsIHBhdGgsIHRleHR1cmUpO1xuXHRcdFx0XHRcdHJlc29sdmUodGV4dHVyZSk7XG5cdFx0XHRcdH07XG5cdFx0XHRcdGltYWdlLm9uZXJyb3IgPSAoKSA9PiB7XG5cdFx0XHRcdFx0Y29uc3QgZXJyb3JNc2cgPSBgQ291bGRuJ3QgbG9hZCBpbWFnZTogJHtwYXRofWA7XG5cdFx0XHRcdFx0dGhpcy5lcnJvcihlcnJvciwgcGF0aCwgZXJyb3JNc2cpO1xuXHRcdFx0XHRcdHJlamVjdChlcnJvck1zZyk7XG5cdFx0XHRcdH07XG5cdFx0XHRcdGlmICh0aGlzLmRvd25sb2FkZXIucmF3RGF0YVVyaXNbcGF0aF0pIHBhdGggPSB0aGlzLmRvd25sb2FkZXIucmF3RGF0YVVyaXNbcGF0aF07XG5cdFx0XHRcdGltYWdlLnNyYyA9IHBhdGg7XG5cdFx0XHR9XG5cdFx0fSk7XG5cdH1cblxuXHRsb2FkVGV4dHVyZUF0bGFzIChwYXRoOiBzdHJpbmcsXG5cdFx0c3VjY2VzczogKHBhdGg6IHN0cmluZywgYXRsYXM6IFRleHR1cmVBdGxhcykgPT4gdm9pZCA9ICgpID0+IHsgfSxcblx0XHRlcnJvcjogKHBhdGg6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nKSA9PiB2b2lkID0gKCkgPT4geyB9LFxuXHRcdGZpbGVBbGlhcz86IHsgW2tleXdvcmQ6IHN0cmluZ106IHN0cmluZyB9XG5cdCkge1xuXHRcdGxldCBpbmRleCA9IHBhdGgubGFzdEluZGV4T2YoXCIvXCIpO1xuXHRcdGxldCBwYXJlbnQgPSBpbmRleCA+PSAwID8gcGF0aC5zdWJzdHJpbmcoMCwgaW5kZXggKyAxKSA6IFwiXCI7XG5cdFx0cGF0aCA9IHRoaXMuc3RhcnQocGF0aCk7XG5cblx0XHRpZiAodGhpcy5yZXVzZUFzc2V0cyhwYXRoLCBzdWNjZXNzLCBlcnJvcikpIHJldHVybjtcblxuXHRcdHRoaXMuY2FjaGUuYXNzZXRzTG9hZGVkW3BhdGhdID0gbmV3IFByb21pc2U8YW55PigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG5cdFx0XHR0aGlzLmRvd25sb2FkZXIuZG93bmxvYWRUZXh0KHBhdGgsIChhdGxhc1RleHQ6IHN0cmluZyk6IHZvaWQgPT4ge1xuXHRcdFx0XHR0cnkge1xuXHRcdFx0XHRcdGNvbnN0IGF0bGFzID0gdGhpcy5jcmVhdGVUZXh0dXJlQXRsYXMocGF0aCwgYXRsYXNUZXh0KTtcblx0XHRcdFx0XHRsZXQgdG9Mb2FkID0gYXRsYXMucGFnZXMubGVuZ3RoLCBhYm9ydCA9IGZhbHNlO1xuXHRcdFx0XHRcdGZvciAobGV0IHBhZ2Ugb2YgYXRsYXMucGFnZXMpIHtcblx0XHRcdFx0XHRcdHRoaXMubG9hZFRleHR1cmUoIWZpbGVBbGlhcyA/IHBhcmVudCArIHBhZ2UubmFtZSA6IGZpbGVBbGlhc1twYWdlLm5hbWUhXSxcblx0XHRcdFx0XHRcdFx0KGltYWdlUGF0aDogc3RyaW5nLCB0ZXh0dXJlOiBUZXh0dXJlKSA9PiB7XG5cdFx0XHRcdFx0XHRcdFx0aWYgKCFhYm9ydCkge1xuXHRcdFx0XHRcdFx0XHRcdFx0cGFnZS5zZXRUZXh0dXJlKHRleHR1cmUpO1xuXHRcdFx0XHRcdFx0XHRcdFx0aWYgKC0tdG9Mb2FkID09IDApIHtcblx0XHRcdFx0XHRcdFx0XHRcdFx0dGhpcy5zdWNjZXNzKHN1Y2Nlc3MsIHBhdGgsIGF0bGFzKTtcblx0XHRcdFx0XHRcdFx0XHRcdFx0cmVzb2x2ZShhdGxhcyk7XG5cdFx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHR9LFxuXHRcdFx0XHRcdFx0XHQoaW1hZ2VQYXRoOiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZykgPT4ge1xuXHRcdFx0XHRcdFx0XHRcdGlmICghYWJvcnQpIHtcblx0XHRcdFx0XHRcdFx0XHRcdGNvbnN0IGVycm9yTXNnID0gYENvdWxkbid0IGxvYWQgdGV4dHVyZSAke3BhdGh9IHBhZ2UgaW1hZ2U6ICR7aW1hZ2VQYXRofWA7XG5cdFx0XHRcdFx0XHRcdFx0XHR0aGlzLmVycm9yKGVycm9yLCBwYXRoLCBlcnJvck1zZyk7XG5cdFx0XHRcdFx0XHRcdFx0XHRyZWplY3QoZXJyb3JNc2cpO1xuXHRcdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0XHRhYm9ydCA9IHRydWU7XG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdCk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9IGNhdGNoIChlKSB7XG5cdFx0XHRcdFx0Y29uc3QgZXJyb3JNc2cgPSBgQ291bGRuJ3QgcGFyc2UgdGV4dHVyZSBhdGxhcyAke3BhdGh9OiAkeyhlIGFzIGFueSkubWVzc2FnZX1gO1xuXHRcdFx0XHRcdHRoaXMuZXJyb3IoZXJyb3IsIHBhdGgsIGVycm9yTXNnKTtcblx0XHRcdFx0XHRyZWplY3QoZXJyb3JNc2cpO1xuXHRcdFx0XHR9XG5cdFx0XHR9LCAoc3RhdHVzOiBudW1iZXIsIHJlc3BvbnNlVGV4dDogc3RyaW5nKTogdm9pZCA9PiB7XG5cdFx0XHRcdGNvbnN0IGVycm9yTXNnID0gYENvdWxkbid0IGxvYWQgdGV4dHVyZSBhdGxhcyAke3BhdGh9OiBzdGF0dXMgJHtzdGF0dXN9LCAke3Jlc3BvbnNlVGV4dH1gO1xuXHRcdFx0XHR0aGlzLmVycm9yKGVycm9yLCBwYXRoLCBlcnJvck1zZyk7XG5cdFx0XHRcdHJlamVjdChlcnJvck1zZyk7XG5cdFx0XHR9KTtcblx0XHR9KTtcblx0fVxuXG5cdGxvYWRUZXh0dXJlQXRsYXNCdXROb1RleHR1cmVzIChwYXRoOiBzdHJpbmcsXG5cdFx0c3VjY2VzczogKHBhdGg6IHN0cmluZywgYXRsYXM6IFRleHR1cmVBdGxhcykgPT4gdm9pZCA9ICgpID0+IHsgfSxcblx0XHRlcnJvcjogKHBhdGg6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nKSA9PiB2b2lkID0gKCkgPT4geyB9LFxuXHRcdGZpbGVBbGlhcz86IHsgW2tleXdvcmQ6IHN0cmluZ106IHN0cmluZyB9XG5cdCkge1xuXHRcdHBhdGggPSB0aGlzLnN0YXJ0KHBhdGgpO1xuXG5cdFx0aWYgKHRoaXMucmV1c2VBc3NldHMocGF0aCwgc3VjY2VzcywgZXJyb3IpKSByZXR1cm47XG5cblx0XHR0aGlzLmNhY2hlLmFzc2V0c0xvYWRlZFtwYXRoXSA9IG5ldyBQcm9taXNlPGFueT4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuXHRcdFx0dGhpcy5kb3dubG9hZGVyLmRvd25sb2FkVGV4dChwYXRoLCAoYXRsYXNUZXh0OiBzdHJpbmcpOiB2b2lkID0+IHtcblx0XHRcdFx0dHJ5IHtcblx0XHRcdFx0XHRjb25zdCBhdGxhcyA9IHRoaXMuY3JlYXRlVGV4dHVyZUF0bGFzKHBhdGgsIGF0bGFzVGV4dCk7XG5cdFx0XHRcdFx0dGhpcy5zdWNjZXNzKHN1Y2Nlc3MsIHBhdGgsIGF0bGFzKTtcblx0XHRcdFx0XHRyZXNvbHZlKGF0bGFzKTtcblx0XHRcdFx0fSBjYXRjaCAoZSkge1xuXHRcdFx0XHRcdGNvbnN0IGVycm9yTXNnID0gYENvdWxkbid0IHBhcnNlIHRleHR1cmUgYXRsYXMgJHtwYXRofTogJHsoZSBhcyBhbnkpLm1lc3NhZ2V9YDtcblx0XHRcdFx0XHR0aGlzLmVycm9yKGVycm9yLCBwYXRoLCBlcnJvck1zZyk7XG5cdFx0XHRcdFx0cmVqZWN0KGVycm9yTXNnKTtcblx0XHRcdFx0fVxuXHRcdFx0fSwgKHN0YXR1czogbnVtYmVyLCByZXNwb25zZVRleHQ6IHN0cmluZyk6IHZvaWQgPT4ge1xuXHRcdFx0XHRjb25zdCBlcnJvck1zZyA9IGBDb3VsZG4ndCBsb2FkIHRleHR1cmUgYXRsYXMgJHtwYXRofTogc3RhdHVzICR7c3RhdHVzfSwgJHtyZXNwb25zZVRleHR9YDtcblx0XHRcdFx0dGhpcy5lcnJvcihlcnJvciwgcGF0aCwgZXJyb3JNc2cpO1xuXHRcdFx0XHRyZWplY3QoZXJyb3JNc2cpO1xuXHRcdFx0fSk7XG5cdFx0fSk7XG5cdH1cblxuXHQvLyBQcm9taXNpZmllZCB2ZXJzaW9ucyBvZiBsb2FkIGZ1bmN0aW9uXG5cdGFzeW5jIGxvYWRCaW5hcnlBc3luYyAocGF0aDogc3RyaW5nKSB7XG5cdFx0cmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcblx0XHRcdHRoaXMubG9hZEJpbmFyeShwYXRoLFxuXHRcdFx0XHQoXywgYmluYXJ5KSA9PiByZXNvbHZlKGJpbmFyeSksXG5cdFx0XHRcdChfLCBtZXNzYWdlKSA9PiByZWplY3QobWVzc2FnZSksXG5cdFx0XHQpO1xuXHRcdH0pO1xuXHR9XG5cblx0YXN5bmMgbG9hZEpzb25Bc3luYyAocGF0aDogc3RyaW5nKSB7XG5cdFx0cmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcblx0XHRcdHRoaXMubG9hZEpzb24ocGF0aCxcblx0XHRcdFx0KF8sIG9iamVjdCkgPT4gcmVzb2x2ZShvYmplY3QpLFxuXHRcdFx0XHQoXywgbWVzc2FnZSkgPT4gcmVqZWN0KG1lc3NhZ2UpLFxuXHRcdFx0KTtcblx0XHR9KTtcblx0fVxuXG5cdGFzeW5jIGxvYWRUZXh0dXJlQXN5bmMgKHBhdGg6IHN0cmluZykge1xuXHRcdHJldHVybiBuZXcgUHJvbWlzZTxUZXh0dXJlPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG5cdFx0XHR0aGlzLmxvYWRUZXh0dXJlKHBhdGgsXG5cdFx0XHRcdChfLCB0ZXh0dXJlKSA9PiByZXNvbHZlKHRleHR1cmUpLFxuXHRcdFx0XHQoXywgbWVzc2FnZSkgPT4gcmVqZWN0KG1lc3NhZ2UpLFxuXHRcdFx0KTtcblx0XHR9KTtcblx0fVxuXG5cdGFzeW5jIGxvYWRUZXh0dXJlQXRsYXNBc3luYyAocGF0aDogc3RyaW5nKSB7XG5cdFx0cmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcblx0XHRcdHRoaXMubG9hZFRleHR1cmVBdGxhcyhwYXRoLFxuXHRcdFx0XHQoXywgYXRsYXMpID0+IHJlc29sdmUoYXRsYXMpLFxuXHRcdFx0XHQoXywgbWVzc2FnZSkgPT4gcmVqZWN0KG1lc3NhZ2UpLFxuXHRcdFx0KTtcblx0XHR9KTtcblx0fVxuXG5cdGFzeW5jIGxvYWRUZXh0dXJlQXRsYXNCdXROb1RleHR1cmVzQXN5bmMgKHBhdGg6IHN0cmluZykge1xuXHRcdHJldHVybiBuZXcgUHJvbWlzZTxUZXh0dXJlQXRsYXM+KChyZXNvbHZlLCByZWplY3QpID0+IHtcblx0XHRcdHRoaXMubG9hZFRleHR1cmVBdGxhc0J1dE5vVGV4dHVyZXMocGF0aCxcblx0XHRcdFx0KF8sIGF0bGFzKSA9PiByZXNvbHZlKGF0bGFzKSxcblx0XHRcdFx0KF8sIG1lc3NhZ2UpID0+IHJlamVjdChtZXNzYWdlKSxcblx0XHRcdCk7XG5cdFx0fSk7XG5cdH1cblxuXHRzZXRDYWNoZSAoY2FjaGU6IEFzc2V0Q2FjaGUpIHtcblx0XHR0aGlzLmNhY2hlID0gY2FjaGU7XG5cdH1cblxuXHRnZXQgKHBhdGg6IHN0cmluZykge1xuXHRcdHJldHVybiB0aGlzLmNhY2hlLmFzc2V0c1t0aGlzLnBhdGhQcmVmaXggKyBwYXRoXTtcblx0fVxuXG5cdHJlcXVpcmUgKHBhdGg6IHN0cmluZykge1xuXHRcdHBhdGggPSB0aGlzLnBhdGhQcmVmaXggKyBwYXRoO1xuXHRcdGxldCBhc3NldCA9IHRoaXMuY2FjaGUuYXNzZXRzW3BhdGhdO1xuXHRcdGlmIChhc3NldCkgcmV0dXJuIGFzc2V0O1xuXHRcdGxldCBlcnJvciA9IHRoaXMuZXJyb3JzW3BhdGhdO1xuXHRcdHRocm93IEVycm9yKFwiQXNzZXQgbm90IGZvdW5kOiBcIiArIHBhdGggKyAoZXJyb3IgPyBcIlxcblwiICsgZXJyb3IgOiBcIlwiKSk7XG5cdH1cblxuXHRyZW1vdmUgKHBhdGg6IHN0cmluZykge1xuXHRcdHBhdGggPSB0aGlzLnBhdGhQcmVmaXggKyBwYXRoO1xuXHRcdGxldCBhc3NldCA9IHRoaXMuY2FjaGUuYXNzZXRzW3BhdGhdO1xuXHRcdGlmIChhc3NldC5kaXNwb3NlKSBhc3NldC5kaXNwb3NlKCk7XG5cdFx0ZGVsZXRlIHRoaXMuY2FjaGUuYXNzZXRzW3BhdGhdO1xuXHRcdGRlbGV0ZSB0aGlzLmNhY2hlLmFzc2V0c1JlZkNvdW50W3BhdGhdO1xuXHRcdGRlbGV0ZSB0aGlzLmNhY2hlLmFzc2V0c0xvYWRlZFtwYXRoXTtcblx0XHRyZXR1cm4gYXNzZXQ7XG5cdH1cblxuXHRyZW1vdmVBbGwgKCkge1xuXHRcdGZvciAobGV0IHBhdGggaW4gdGhpcy5jYWNoZS5hc3NldHMpIHtcblx0XHRcdGxldCBhc3NldCA9IHRoaXMuY2FjaGUuYXNzZXRzW3BhdGhdO1xuXHRcdFx0aWYgKGFzc2V0LmRpc3Bvc2UpIGFzc2V0LmRpc3Bvc2UoKTtcblx0XHR9XG5cdFx0dGhpcy5jYWNoZS5hc3NldHMgPSB7fTtcblx0XHR0aGlzLmNhY2hlLmFzc2V0c0xvYWRlZCA9IHt9O1xuXHRcdHRoaXMuY2FjaGUuYXNzZXRzUmVmQ291bnQgPSB7fTtcblx0fVxuXG5cdGlzTG9hZGluZ0NvbXBsZXRlICgpOiBib29sZWFuIHtcblx0XHRyZXR1cm4gdGhpcy50b0xvYWQgPT0gMDtcblx0fVxuXG5cdGdldFRvTG9hZCAoKTogbnVtYmVyIHtcblx0XHRyZXR1cm4gdGhpcy50b0xvYWQ7XG5cdH1cblxuXHRnZXRMb2FkZWQgKCk6IG51bWJlciB7XG5cdFx0cmV0dXJuIHRoaXMubG9hZGVkO1xuXHR9XG5cblx0ZGlzcG9zZSAoKSB7XG5cdFx0dGhpcy5yZW1vdmVBbGwoKTtcblx0fVxuXG5cdC8vIGRpc3Bvc2UgYXNzZXQgb25seSBpZiBpdCdzIG5vdCB1c2VkIGJ5IG90aGVyc1xuXHRkaXNwb3NlQXNzZXQgKHBhdGg6IHN0cmluZykge1xuXHRcdGNvbnN0IGFzc2V0ID0gdGhpcy5jYWNoZS5hc3NldHNbcGF0aF07XG5cdFx0aWYgKGFzc2V0IGluc3RhbmNlb2YgVGV4dHVyZUF0bGFzKSB7XG5cdFx0XHRhc3NldC5kaXNwb3NlKCk7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdHRoaXMuZGlzcG9zZUFzc2V0SW50ZXJuYWwocGF0aCk7XG5cdH1cblxuXHRoYXNFcnJvcnMgKCkge1xuXHRcdHJldHVybiBPYmplY3Qua2V5cyh0aGlzLmVycm9ycykubGVuZ3RoID4gMDtcblx0fVxuXG5cdGdldEVycm9ycyAoKSB7XG5cdFx0cmV0dXJuIHRoaXMuZXJyb3JzO1xuXHR9XG5cblx0cHJpdmF0ZSBkaXNwb3NlQXNzZXRJbnRlcm5hbCAocGF0aDogc3RyaW5nKSB7XG5cdFx0aWYgKHRoaXMuY2FjaGUuYXNzZXRzUmVmQ291bnRbcGF0aF0gPiAwICYmIC0tdGhpcy5jYWNoZS5hc3NldHNSZWZDb3VudFtwYXRoXSA9PT0gMCkge1xuXHRcdFx0cmV0dXJuIHRoaXMucmVtb3ZlKHBhdGgpO1xuXHRcdH1cblx0fVxuXG5cdHByaXZhdGUgY3JlYXRlVGV4dHVyZUF0bGFzIChwYXRoOiBzdHJpbmcsIGF0bGFzVGV4dDogc3RyaW5nKTogVGV4dHVyZUF0bGFzIHtcblx0XHRjb25zdCBhdGxhcyA9IG5ldyBUZXh0dXJlQXRsYXMoYXRsYXNUZXh0KTtcblx0XHRhdGxhcy5kaXNwb3NlID0gKCkgPT4ge1xuXHRcdFx0aWYgKHRoaXMuY2FjaGUuYXNzZXRzUmVmQ291bnRbcGF0aF0gPD0gMCkgcmV0dXJuO1xuXHRcdFx0dGhpcy5kaXNwb3NlQXNzZXRJbnRlcm5hbChwYXRoKTtcblx0XHRcdGZvciAoY29uc3QgcGFnZSBvZiBhdGxhcy5wYWdlcykge1xuXHRcdFx0XHRwYWdlLnRleHR1cmU/LmRpc3Bvc2UoKTtcblx0XHRcdH1cblx0XHR9XG5cdFx0cmV0dXJuIGF0bGFzO1xuXHR9XG5cblx0cHJpdmF0ZSBjcmVhdGVUZXh0dXJlIChwYXRoOiBzdHJpbmcsIGltYWdlOiBIVE1MSW1hZ2VFbGVtZW50IHwgSW1hZ2VCaXRtYXApOiBUZXh0dXJlIHtcblx0XHRjb25zdCB0ZXh0dXJlID0gdGhpcy50ZXh0dXJlTG9hZGVyKGltYWdlKTtcblx0XHRjb25zdCB0ZXh0dXJlRGlzcG9zZSA9IHRleHR1cmUuZGlzcG9zZS5iaW5kKHRleHR1cmUpO1xuXHRcdHRleHR1cmUuZGlzcG9zZSA9ICgpID0+IHtcblx0XHRcdGlmICh0aGlzLmRpc3Bvc2VBc3NldEludGVybmFsKHBhdGgpKSB0ZXh0dXJlRGlzcG9zZSgpO1xuXHRcdH1cblx0XHRyZXR1cm4gdGV4dHVyZTtcblx0fVxufVxuXG5leHBvcnQgY2xhc3MgQXNzZXRDYWNoZSB7XG5cdHB1YmxpYyBhc3NldHM6IFN0cmluZ01hcDxhbnk+ID0ge307XG5cdHB1YmxpYyBhc3NldHNSZWZDb3VudDogU3RyaW5nTWFwPG51bWJlcj4gPSB7fTtcblx0cHVibGljIGFzc2V0c0xvYWRlZDogU3RyaW5nTWFwPFByb21pc2U8YW55Pj4gPSB7fTtcblxuXHRzdGF0aWMgQVZBSUxBQkxFX0NBQ0hFUyA9IG5ldyBNYXA8c3RyaW5nLCBBc3NldENhY2hlPigpO1xuXHRzdGF0aWMgZ2V0Q2FjaGUgKGlkOiBzdHJpbmcpIHtcblx0XHRjb25zdCBjYWNoZSA9IEFzc2V0Q2FjaGUuQVZBSUxBQkxFX0NBQ0hFUy5nZXQoaWQpO1xuXHRcdGlmIChjYWNoZSkgcmV0dXJuIGNhY2hlO1xuXG5cdFx0Y29uc3QgbmV3Q2FjaGUgPSBuZXcgQXNzZXRDYWNoZSgpO1xuXHRcdEFzc2V0Q2FjaGUuQVZBSUxBQkxFX0NBQ0hFUy5zZXQoaWQsIG5ld0NhY2hlKTtcblx0XHRyZXR1cm4gbmV3Q2FjaGU7XG5cdH1cblxuXHRhc3luYyBhZGRBc3NldCAocGF0aDogc3RyaW5nLCBhc3NldDogYW55KSB7XG5cdFx0dGhpcy5hc3NldHNMb2FkZWRbcGF0aF0gPSBQcm9taXNlLnJlc29sdmUoYXNzZXQpO1xuXHRcdHRoaXMuYXNzZXRzW3BhdGhdID0gYXdhaXQgYXNzZXQ7XG5cdH1cbn1cblxuZXhwb3J0IGNsYXNzIERvd25sb2FkZXIge1xuXHRwcml2YXRlIGNhbGxiYWNrczogU3RyaW5nTWFwPEFycmF5PEZ1bmN0aW9uPj4gPSB7fTtcblx0cmF3RGF0YVVyaXM6IFN0cmluZ01hcDxzdHJpbmc+ID0ge307XG5cblx0ZGF0YVVyaVRvU3RyaW5nIChkYXRhVXJpOiBzdHJpbmcpIHtcblx0XHRpZiAoIWRhdGFVcmkuc3RhcnRzV2l0aChcImRhdGE6XCIpKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoXCJOb3QgYSBkYXRhIFVSSS5cIik7XG5cdFx0fVxuXG5cdFx0bGV0IGJhc2U2NElkeCA9IGRhdGFVcmkuaW5kZXhPZihcImJhc2U2NCxcIik7XG5cdFx0aWYgKGJhc2U2NElkeCAhPSAtMSkge1xuXHRcdFx0YmFzZTY0SWR4ICs9IFwiYmFzZTY0LFwiLmxlbmd0aDtcblx0XHRcdHJldHVybiBhdG9iKGRhdGFVcmkuc3Vic3RyKGJhc2U2NElkeCkpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRyZXR1cm4gZGF0YVVyaS5zdWJzdHIoZGF0YVVyaS5pbmRleE9mKFwiLFwiKSArIDEpO1xuXHRcdH1cblx0fVxuXG5cdGJhc2U2NFRvVWludDhBcnJheSAoYmFzZTY0OiBzdHJpbmcpIHtcblx0XHR2YXIgYmluYXJ5X3N0cmluZyA9IHdpbmRvdy5hdG9iKGJhc2U2NCk7XG5cdFx0dmFyIGxlbiA9IGJpbmFyeV9zdHJpbmcubGVuZ3RoO1xuXHRcdHZhciBieXRlcyA9IG5ldyBVaW50OEFycmF5KGxlbik7XG5cdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuXHRcdFx0Ynl0ZXNbaV0gPSBiaW5hcnlfc3RyaW5nLmNoYXJDb2RlQXQoaSk7XG5cdFx0fVxuXHRcdHJldHVybiBieXRlcztcblx0fVxuXG5cdGRhdGFVcmlUb1VpbnQ4QXJyYXkgKGRhdGFVcmk6IHN0cmluZykge1xuXHRcdGlmICghZGF0YVVyaS5zdGFydHNXaXRoKFwiZGF0YTpcIikpIHtcblx0XHRcdHRocm93IG5ldyBFcnJvcihcIk5vdCBhIGRhdGEgVVJJLlwiKTtcblx0XHR9XG5cblx0XHRsZXQgYmFzZTY0SWR4ID0gZGF0YVVyaS5pbmRleE9mKFwiYmFzZTY0LFwiKTtcblx0XHRpZiAoYmFzZTY0SWR4ID09IC0xKSB0aHJvdyBuZXcgRXJyb3IoXCJOb3QgYSBiaW5hcnkgZGF0YSBVUkkuXCIpO1xuXHRcdGJhc2U2NElkeCArPSBcImJhc2U2NCxcIi5sZW5ndGg7XG5cdFx0cmV0dXJuIHRoaXMuYmFzZTY0VG9VaW50OEFycmF5KGRhdGFVcmkuc3Vic3RyKGJhc2U2NElkeCkpO1xuXHR9XG5cblx0ZG93bmxvYWRUZXh0ICh1cmw6IHN0cmluZywgc3VjY2VzczogKGRhdGE6IHN0cmluZykgPT4gdm9pZCwgZXJyb3I6IChzdGF0dXM6IG51bWJlciwgcmVzcG9uc2VUZXh0OiBzdHJpbmcpID0+IHZvaWQpIHtcblx0XHRpZiAodGhpcy5zdGFydCh1cmwsIHN1Y2Nlc3MsIGVycm9yKSkgcmV0dXJuO1xuXG5cdFx0Y29uc3QgcmF3RGF0YVVyaSA9IHRoaXMucmF3RGF0YVVyaXNbdXJsXTtcblx0XHQvLyB3ZSBhc3N1bWUgaWYgYSBcIi5cIiBpcyBpbmNsdWRlZCBpbiBhIHJhdyBkYXRhIHVyaSwgaXQgaXMgdXNlZCB0byByZXdyaXRlIGFuIGFzc2V0IFVSTFxuXHRcdGlmIChyYXdEYXRhVXJpICYmICFyYXdEYXRhVXJpLmluY2x1ZGVzKFwiLlwiKSkge1xuXHRcdFx0dHJ5IHtcblx0XHRcdFx0dGhpcy5maW5pc2godXJsLCAyMDAsIHRoaXMuZGF0YVVyaVRvU3RyaW5nKHJhd0RhdGFVcmkpKTtcblx0XHRcdH0gY2F0Y2ggKGUpIHtcblx0XHRcdFx0dGhpcy5maW5pc2godXJsLCA0MDAsIEpTT04uc3RyaW5naWZ5KGUpKTtcblx0XHRcdH1cblx0XHRcdHJldHVybjtcblx0XHR9XG5cblx0XHRsZXQgcmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuXHRcdHJlcXVlc3Qub3ZlcnJpZGVNaW1lVHlwZShcInRleHQvaHRtbFwiKTtcblx0XHRyZXF1ZXN0Lm9wZW4oXCJHRVRcIiwgcmF3RGF0YVVyaSA/IHJhd0RhdGFVcmkgOiB1cmwsIHRydWUpO1xuXHRcdGxldCBkb25lID0gKCkgPT4ge1xuXHRcdFx0dGhpcy5maW5pc2godXJsLCByZXF1ZXN0LnN0YXR1cywgcmVxdWVzdC5yZXNwb25zZVRleHQpO1xuXHRcdH07XG5cdFx0cmVxdWVzdC5vbmxvYWQgPSBkb25lO1xuXHRcdHJlcXVlc3Qub25lcnJvciA9IGRvbmU7XG5cdFx0cmVxdWVzdC5zZW5kKCk7XG5cdH1cblxuXHRkb3dubG9hZEpzb24gKHVybDogc3RyaW5nLCBzdWNjZXNzOiAoZGF0YTogb2JqZWN0KSA9PiB2b2lkLCBlcnJvcjogKHN0YXR1czogbnVtYmVyLCByZXNwb25zZVRleHQ6IHN0cmluZykgPT4gdm9pZCkge1xuXHRcdHRoaXMuZG93bmxvYWRUZXh0KHVybCwgKGRhdGE6IHN0cmluZyk6IHZvaWQgPT4ge1xuXHRcdFx0c3VjY2VzcyhKU09OLnBhcnNlKGRhdGEpKTtcblx0XHR9LCBlcnJvcik7XG5cdH1cblxuXHRkb3dubG9hZEJpbmFyeSAodXJsOiBzdHJpbmcsIHN1Y2Nlc3M6IChkYXRhOiBVaW50OEFycmF5KSA9PiB2b2lkLCBlcnJvcjogKHN0YXR1czogbnVtYmVyLCByZXNwb25zZVRleHQ6IHN0cmluZykgPT4gdm9pZCkge1xuXHRcdGlmICh0aGlzLnN0YXJ0KHVybCwgc3VjY2VzcywgZXJyb3IpKSByZXR1cm47XG5cblx0XHRjb25zdCByYXdEYXRhVXJpID0gdGhpcy5yYXdEYXRhVXJpc1t1cmxdO1xuXHRcdC8vIHdlIGFzc3VtZSBpZiBhIFwiLlwiIGlzIGluY2x1ZGVkIGluIGEgcmF3IGRhdGEgdXJpLCBpdCBpcyB1c2VkIHRvIHJld3JpdGUgYW4gYXNzZXQgVVJMXG5cdFx0aWYgKHJhd0RhdGFVcmkgJiYgIXJhd0RhdGFVcmkuaW5jbHVkZXMoXCIuXCIpKSB7XG5cdFx0XHR0cnkge1xuXHRcdFx0XHR0aGlzLmZpbmlzaCh1cmwsIDIwMCwgdGhpcy5kYXRhVXJpVG9VaW50OEFycmF5KHJhd0RhdGFVcmkpKTtcblx0XHRcdH0gY2F0Y2ggKGUpIHtcblx0XHRcdFx0dGhpcy5maW5pc2godXJsLCA0MDAsIEpTT04uc3RyaW5naWZ5KGUpKTtcblx0XHRcdH1cblx0XHRcdHJldHVybjtcblx0XHR9XG5cblx0XHRsZXQgcmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuXHRcdHJlcXVlc3Qub3BlbihcIkdFVFwiLCByYXdEYXRhVXJpID8gcmF3RGF0YVVyaSA6IHVybCwgdHJ1ZSk7XG5cdFx0cmVxdWVzdC5yZXNwb25zZVR5cGUgPSBcImFycmF5YnVmZmVyXCI7XG5cdFx0bGV0IG9uZXJyb3IgPSAoKSA9PiB7XG5cdFx0XHR0aGlzLmZpbmlzaCh1cmwsIHJlcXVlc3Quc3RhdHVzLCByZXF1ZXN0LnJlc3BvbnNlKTtcblx0XHR9O1xuXHRcdHJlcXVlc3Qub25sb2FkID0gKCkgPT4ge1xuXHRcdFx0aWYgKHJlcXVlc3Quc3RhdHVzID09IDIwMCB8fCByZXF1ZXN0LnN0YXR1cyA9PSAwKVxuXHRcdFx0XHR0aGlzLmZpbmlzaCh1cmwsIDIwMCwgbmV3IFVpbnQ4QXJyYXkocmVxdWVzdC5yZXNwb25zZSBhcyBBcnJheUJ1ZmZlcikpO1xuXHRcdFx0ZWxzZVxuXHRcdFx0XHRvbmVycm9yKCk7XG5cdFx0fTtcblx0XHRyZXF1ZXN0Lm9uZXJyb3IgPSBvbmVycm9yO1xuXHRcdHJlcXVlc3Quc2VuZCgpO1xuXHR9XG5cblx0cHJpdmF0ZSBzdGFydCAodXJsOiBzdHJpbmcsIHN1Y2Nlc3M6IGFueSwgZXJyb3I6IGFueSkge1xuXHRcdGxldCBjYWxsYmFja3MgPSB0aGlzLmNhbGxiYWNrc1t1cmxdO1xuXHRcdHRyeSB7XG5cdFx0XHRpZiAoY2FsbGJhY2tzKSByZXR1cm4gdHJ1ZTtcblx0XHRcdHRoaXMuY2FsbGJhY2tzW3VybF0gPSBjYWxsYmFja3MgPSBbXTtcblx0XHR9IGZpbmFsbHkge1xuXHRcdFx0Y2FsbGJhY2tzLnB1c2goc3VjY2VzcywgZXJyb3IpO1xuXHRcdH1cblx0fVxuXG5cdHByaXZhdGUgZmluaXNoICh1cmw6IHN0cmluZywgc3RhdHVzOiBudW1iZXIsIGRhdGE6IGFueSkge1xuXHRcdGxldCBjYWxsYmFja3MgPSB0aGlzLmNhbGxiYWNrc1t1cmxdO1xuXHRcdGRlbGV0ZSB0aGlzLmNhbGxiYWNrc1t1cmxdO1xuXHRcdGxldCBhcmdzID0gc3RhdHVzID09IDIwMCB8fCBzdGF0dXMgPT0gMCA/IFtkYXRhXSA6IFtzdGF0dXMsIGRhdGFdO1xuXHRcdGZvciAobGV0IGkgPSBhcmdzLmxlbmd0aCAtIDEsIG4gPSBjYWxsYmFja3MubGVuZ3RoOyBpIDwgbjsgaSArPSAyKVxuXHRcdFx0Y2FsbGJhY2tzW2ldLmFwcGx5KG51bGwsIGFyZ3MpO1xuXHR9XG59XG4iXX0=