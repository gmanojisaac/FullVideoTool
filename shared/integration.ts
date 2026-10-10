export type AssetStatus = 'Missing' | 'Ready' | 'Outdated' | 'Failed' | 'Requires Review';
export interface ProjectAsset { filename: string; type: string; status: AssetStatus; resolution?: { width: number; height: number }; generatedAt?: string; downloadUrl?: string; detail?: string }
export interface ProjectDashboard { version: 1; projectId: string; refreshedAt: string; assets: ProjectAsset[]; warnings: string[] }
