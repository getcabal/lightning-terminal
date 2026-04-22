export interface PublishedSkillVersion {
  skillId: string;
  title: string;
  summary: string;
  priceSats: number;
  contentSha256: string;
  blobPath: string;
  isActive: boolean;
  createdAt?: string;
}

export interface SkillManifest {
  skill_id: string;
  title: string;
  summary: string;
  purchase_model: string;
  price_sats: number;
  content_sha256: string;
  manifest_url: string;
  paid_url: string;
  content_type: string;
}

export interface PublishSkillInput {
  skillId: string;
  title: string;
  summary: string;
  priceSats: number;
  content: string;
}

export interface L402Challenge {
  invoice: string;
  macaroonB64: string;
  paymentHash: string;
  headers: string[];
}

export interface L402Verification {
  valid: boolean;
  reason?: string;
  paymentHash?: string;
  skillId?: string;
  contentSha256?: string;
}
