/** Announcement 인터페이스 — 모든 크롤러 공통 스키마. */

export interface Announcement {
  id: string;
  name: string;
  region: string;
  district: string;
  address: string;
  period: string;
  rcept_end: string;
  rcept_bgn?: string;
  total_units: string;
  house_type: string;
  house_category: string;
  constructor: string;
  url: string;
  size: string;
  speculative_zone: string;
  price_controlled: string;
  schedule_source: string;
  notice_date?: string;
  winner_date?: string;
  contract_start?: string;
  contract_end?: string;
  d_day?: number | null;
  d_day_label?: string;
}

/** DB announcements 테이블 행 타입. */
export interface AnnouncementRow {
  id: string;
  category: string;
  name: string;
  region: string;
  district: string;
  address: string;
  period: string;
  rcept_end: string;
  rcept_bgn: string;
  total_units: string;
  house_type: string;
  house_category: string;
  constructor: string;
  url: string;
  size: string;
  speculative_zone: string;
  price_controlled: string;
  schedule_source: string;
  notice_date: string | null;
  winner_date: string | null;
  contract_start: string | null;
  contract_end: string | null;
  crawled_at: string;
  updated_at: string;
}

/** crawl_metadata 테이블 행 타입. */
export interface CrawlMetadataRow {
  cache_key: string;
  category: string;
  months_back: number;
  item_count: number;
  crawled_at: string;
  ttl_seconds: number;
}
