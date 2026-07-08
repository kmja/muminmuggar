export type MugStatus = "owned" | "wishlist" | "sold";

export interface Listing {
  id?: number;
  source: string;
  title: string;
  price: number | null;
  currency: string | null;
  url: string;
  imageUrl: string | null;
  condition: string | null;
  foundAt?: string;
}

export interface Mug {
  id: string;
  name: string;
  series: string | null;
  edition: string | null;
  year: number | null;
  status: MugStatus;
  condition: string | null;
  conditionNotes: string | null;
  location: string | null;
  acquiredDate: string | null;
  price: number | "" | null;
  currency: string | null;
  favorite: boolean;
  photoUrl: string | null;
  estValueLow: number | null;
  estValueHigh: number | null;
  estValueCurrency: string | null;
  notes: string | null;
  tags: string[];
  aiConfidence: number | null;
  createdAt?: string;
  updatedAt?: string;
  listings?: Listing[];
}

/** Shape returned by Gemini identification, before it becomes a Mug draft. */
export interface AiMug {
  isMoominMug?: boolean;
  character?: string;
  series?: string;
  edition?: string;
  year?: number | null;
  condition?: string;
  conditionNotes?: string;
  estimatedValueLow?: number | null;
  estimatedValueHigh?: number | null;
  valueCurrency?: string;
  confidence?: number;
  notes?: string;
  position?: string;
}
