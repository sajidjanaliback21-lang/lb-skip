export interface MappingConfig {
  [ip: string]: string;
}

export interface PlaylistRewriteStats {
  originalLength: number;
  rewrittenLength: number;
  ipsFound: { [ip: string]: number };
  totalReplacements: number;
  processingTimeMs: number;
  timestamp: string;
}

export interface ConversionHistoryItem {
  id: string;
  timestamp: string;
  sourceUrl: string;
  customDomain: string;
  replacementsCount: number;
  originalSize: string;
  rewrittenSize: string;
}
