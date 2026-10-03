// Which release records a deployment receipt closes, and with what status.
//
// Only PENDING records are ever touched (a record someone already set to
// SUCCESS or FAILED stays as it is), always in the receipt's own environment
// and server role. A record matches by the PATCH_ID in its note, by the image
// the toolkit actually applied (service + version), or both. When the toolkit
// applied specific images, a record also has to be for one of them: each server
// applies only the images its own compose file uses, and a record for a service
// that was not applied must not be closed by this receipt.

import type { ParsedReceipt, ReceiptImage } from './receiptParse.js';
import { imageTag } from './configDrift.js';
import { sameVersion } from './healthModel.js';
import { trackerEnv } from './toolkitParse.js';

export interface MatchableRecord {
  id: string;
  environment: string;
  server: string;
  service: string;
  version: string;
  status: string;
  note?: string | null;
}

export interface ReceiptMatch {
  record: MatchableRecord;
  via: 'patch-id' | 'image' | 'both';
  newStatus: 'SUCCESS' | 'FAILED' | null; // null: the record stays PENDING (note only)
}

export interface ReceiptMatchResult {
  matches: ReceiptMatch[];
  unmatchedImages: ReceiptImage[]; // applied images no record was found for
}

const repoName = (ref: string) => {
  const last = ref.split('@')[0].split('/').pop() ?? ref;
  return last.includes(':') ? last.slice(0, last.lastIndexOf(':')) : last;
};

function noteMentions(note: string | null | undefined, patchId: string): boolean {
  if (!note) return false;
  const esc = patchId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Whole token; a sentence-ending period is fine, a dotted continuation (ID.2) is not.
  return new RegExp(`(^|[^\\w.-])${esc}(?![\\w-])(?!\\.[\\w-])`, 'i').test(note);
}

const imageMatches = (rec: MatchableRecord, img: ReceiptImage) =>
  (rec.service === img.service || rec.service === repoName(img.newRef)) && sameVersion(imageTag(img.newRef), rec.version);

const serviceMatches = (rec: MatchableRecord, img: ReceiptImage) => rec.service === img.service || rec.service === repoName(img.newRef);

export function matchReceipt(receipt: ParsedReceipt, records: MatchableRecord[]): ReceiptMatchResult {
  const env = trackerEnv(receipt.environment);
  const newStatus = receipt.verdict === 'success' ? 'SUCCESS' : receipt.verdict === 'failed' ? 'FAILED' : null;
  const pending = records.filter(
    (r) => trackerEnv(r.environment) === env && r.server === receipt.role && String(r.status || '').toUpperCase() === 'PENDING'
  );

  const matches: ReceiptMatch[] = [];
  for (const rec of pending) {
    const byId = noteMentions(rec.note, receipt.patchId);
    const byImage = receipt.images.some((i) => imageMatches(rec, i));
    const serviceApplied = receipt.images.some((i) => serviceMatches(rec, i));
    if (receipt.images.length > 0) {
      // The toolkit applied specific images: the record must be for one of them,
      // and agree on the version or carry this PATCH_ID.
      if (!serviceApplied || !(byImage || byId)) continue;
    } else if (!byId) {
      continue; // nothing applied: only the PATCH_ID can tie a record to this run
    }
    matches.push({ record: rec, via: byId && byImage ? 'both' : byImage ? 'image' : 'patch-id', newStatus });
  }

  const unmatchedImages = receipt.images.filter((img) => !matches.some((m) => serviceMatches(m.record, img)));
  return { matches, unmatchedImages };
}

// One line added to a record's note when a receipt closes (or annotates) it.
export function receiptNote(receipt: ParsedReceipt): string {
  const when = receipt.finishedAt.slice(0, 16).replace('T', ' ');
  const what = receipt.result ?? receipt.outcome;
  return `[receipt ${when} UTC] ${what}, exit ${receipt.exitCode}${receipt.host ? ` on ${receipt.host}` : ''}${receipt.recordId ? `, toolkit record ${receipt.recordId}` : ''}. ${receipt.reason}`;
}
