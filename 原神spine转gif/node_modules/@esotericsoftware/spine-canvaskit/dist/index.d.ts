/******************************************************************************
 * Spine Runtimes License Agreement
 * Last updated July 28, 2023. Replaces all prior versions.
 *
 * Copyright (c) 2013-2023, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software or
 * otherwise create derivative works of the Spine Runtimes (collectively,
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
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THE
 * SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/
export * from "@esotericsoftware/spine-core";
import { AnimationState, Physics, Skeleton, type SkeletonData, TextureAtlas } from "@esotericsoftware/spine-core";
import type { Canvas, CanvasKit } from "canvaskit-wasm";
/**
 * Loads a {@link TextureAtlas} and its atlas page images from the given file path using the `readFile(path: string): Promise<Buffer>` function.
 * Throws an `Error` if the file or one of the atlas page images could not be loaded.
 */
export declare function loadTextureAtlas(ck: CanvasKit, atlasFile: string, readFile: (path: string) => Promise<ArrayBuffer | Buffer>): Promise<TextureAtlas>;
/**
 * Loads a {@link SkeletonData} from the given file path (`.json` or `.skel`) using the `readFile(path: string): Promise<Buffer>` function.
 * Attachments will be looked up in the provided atlas.
 */
export declare function loadSkeletonData(skeletonFile: string, atlas: TextureAtlas, readFile: (path: string) => Promise<ArrayBuffer | Buffer>, scale?: number): Promise<SkeletonData>;
/**
 * Manages a {@link Skeleton} and its associated {@link AnimationState}. A drawable is constructed from a {@link SkeletonData}, which can
 * be shared by any number of drawables.
 */
export declare class SkeletonDrawable {
    readonly skeleton: Skeleton;
    readonly animationState: AnimationState;
    /**
     * Constructs a new drawble from the skeleton data.
     */
    constructor(skeletonData: SkeletonData);
    /**
     * Updates the animation state and skeleton time by the delta time. Applies the
     * animations to the skeleton and calculates the final pose of the skeleton.
     *
     * @param deltaTime the time since the last update in seconds
     * @param physicsUpdate optional {@link Physics} update mode.
     */
    update(deltaTime: number, physicsUpdate?: Physics): void;
}
/**
 * Renders a {@link Skeleton} or {@link SkeletonDrawable} to a CanvasKit {@link Canvas}.
 */
export declare class SkeletonRenderer {
    private ck;
    private clipper;
    private static QUAD_TRIANGLES;
    private scratchPositions;
    private scratchUVs;
    private scratchColors;
    /**
     * Creates a new skeleton renderer.
     * @param ck the {@link CanvasKit} instance returned by `CanvasKitInit()`.
     */
    constructor(ck: CanvasKit);
    /**
     * Renders a skeleton or skeleton drawable in its current pose to the canvas.
     * @param canvas the canvas to render to.
     * @param skeleton the skeleton or drawable to render.
     */
    render(canvas: Canvas, skeleton: Skeleton | SkeletonDrawable): void;
}
