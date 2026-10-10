import type { Project } from './project';
import type { ExtractionManifest } from './extraction';
import type { LayoutManifest, OutputFormat } from './layout';
import type { FocusConfig } from './focus';
import type { AnimationManifest } from './animation';
import type { FrameValidationReport } from './frames';

export type ExportScope = 'complete' | OutputFormat;
export interface ExportContext { project: Project; extraction: ExtractionManifest; layout: LayoutManifest; focus: FocusConfig; animation: AnimationManifest; frames: FrameValidationReport }
export interface ExportSettings { version: 1; projectName: string; lessonTitle: string }
export interface ExportEntry { path: string; category: string; module: number; size: number; sha256: string; resolution?: { width: number; height: number }; duration?: number; tileNumber?: number; format?: OutputFormat; mandatory: boolean; validation: 'PASS'; sourceFilename?: string }
export interface ExportValidation { timestamp: string; scope: ExportScope; status: 'PASS' | 'FAIL'; results: { filename: string; status: 'PASS' | 'FAIL' | 'SKIPPED'; reason: string }[]; warnings: string[] }
export interface ExportManifest { version: 1; packageVersion: 1; applicationVersion: string; module: 7; projectId: string; exportId: string; projectName: string; lessonTitle: string; scope: ExportScope; exportedAt: string; configurationSha256: string; totalFileCount: number; overallValidation: 'PASS'; files: ExportEntry[]; validation: ExportValidation; manifestCoverage: string }
export interface ExportReceipt { version: 1; exportId: string; projectId: string; filename: string; archiveSha256: string; archiveBytes: number; manifestSha256: string; zipValidation: 'PASS'; fileCount: number; maximumInputChunkBytes: number; completedAt: string; downloadUrl: string; manifestUrl: string; receiptUrl: string }
export interface ExportJob { id: string; projectId: string; scope: ExportScope; status: 'running' | 'complete' | 'failed' | 'cancelled'; progress: number; message: string; startedAt: string; updatedAt: string; error?: string; validation?: ExportValidation; receipt?: ExportReceipt }
export interface ExportState { settings: ExportSettings; job: ExportJob | null; receipt: ExportReceipt | null; current: boolean; reason?: string }
