import type { CameraTransform } from './focus';
import type { OutputFormat } from './layout';
import type { AnimationManifest, VideoProbe, VideoTools } from './animation';

export const geminiFrameFilename = (format: OutputFormat, n: number) => `${format}_tile_${String(n).padStart(2, '0')}_gemini_first_frame.png`;
export const frameKey = (f: { format: OutputFormat; tileNumber: number }) => `${f.format}-${f.tileNumber}`;
export interface PixelDifference { differingPixels: number; differingChannels: number; maxAbsoluteDifference: number; meanAbsoluteDifference: number; rootMeanSquareDifference: number }
export interface FrameValidation {
  projectId: string; tileNumber: number; format: OutputFormat; zoomInFilename: string; zoomOutFilename: string; geminiPngFilename: string; relativePath: string;
  video: VideoProbe; pngResolution: { width: number; height: number }; lastFrameIndex: number; lastPresentationTimestamp: number; lastFrameIsKeyframe: boolean;
  pngFileSha256: string; pngRgbSha256: string; videoRgbSha256: string; zoomOutRgbSha256: string;
  exactDecodedPixelMatch: 'PASS' | 'FAIL'; zoomOutGeometryMatch: 'PASS' | 'FAIL'; zoomOutDecodedPixelMatch: 'PASS' | 'FAIL';
  pixelDifference: PixelDifference; zoomOutPixelDifference: PixelDifference; readyForGemini: boolean; warnings: string[]; validatedAt: string; error?: string;
  extractionDecodeId: string; verificationDecodeId: string; sourceZoomInSha256: string; sourceZoomOutSha256: string;
  imageUrl: string; downloadUrl: string; zoomOutStartImageUrl: string; zoomInPlaybackUrl: string; zoomOutPlaybackUrl: string;
  focusedTransform: CameraTransform; zoomOutStartTransform: CameraTransform;
}
export interface FrameBridge { format: OutputFormat; tileNumber: number; filename: string; relativePath: string; frameCount: number; duration: number; sourcePngSha256: string; videoSha256: string; probe: VideoProbe; playbackUrl: string; downloadUrl: string }
export interface FrameValidationReport {
  version: 1; module: 6; projectId: string; generationId: string; animationRenderId: string; animationConfigurationSha256: string;
  updatedAt: string; frames: FrameValidation[]; bridges: FrameBridge[]; outputDirectory: string; reportUrl: string; allFramesDownloadUrl: string;
  failures: { format: OutputFormat; tileNumber: number; error: string; validatedAt: string }[];
  decodePipeline: { version: 1; name: 'sequential-presentation-rgb24'; ffmpegVersion: string; ffprobeVersion: string; arguments: string[]; selection: string; verification: string };
}
export interface FrameSettings { bridgeDuration: number }
export interface FrameJob { id: string; projectId: string; status: 'running' | 'complete' | 'failed' | 'cancelled'; operation: 'extract' | 'verify' | 'bridge'; progress: number; message: string; startedAt: string; updatedAt: string; cancelRequested: boolean; report?: FrameValidationReport; error?: string }
export interface FrameState { source: AnimationManifest | null; report: FrameValidationReport | null; job: FrameJob | null; settings: FrameSettings; tools: VideoTools; reason?: string }
export interface FrameRequest { operation: 'extract' | 'verify' | 'bridge'; scope: 'all' | 'tile'; format: OutputFormat; tileNumber: number; expectedAnimationRenderId: string; bridgeDuration: number }
export const frameCheckNames = [
  'Extract mobile tile 1', 'Extract desktop tile 1', 'Mobile PNG resolution', 'Desktop PNG resolution',
  'Zero decoded RGB pixel differences', 'Matching independent RGB hashes', 'Detect modified PNG pixel',
  'Reject corrupt video', 'Reject missing video', 'Select last displayed frame beyond last keyframe',
  'Zoom-out focus geometry matches', 'Detect mismatched zoom-out start', 'Extract six mobile PNGs', 'Extract six desktop PNGs',
  'Twelve filenames and paths', 'Generate optional still bridge', 'Accurate validation report', 'Retain settings after restart',
  'Module 1–5 regression checks',
] as const;
