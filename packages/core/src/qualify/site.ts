import { z } from 'zod';
import { SettingsSchema } from '../types';

export const SiteGateSettingsSchema = SettingsSchema.pick({
  siteMode: true,
  excludedSites: true,
  allowedSites: true,
});
export type SiteGateSettings = z.infer<typeof SiteGateSettingsSchema>;

export const MatchSiteRuleInputSchema = z.object({
  url: z.string().min(1),
  rule: z.string().min(1),
});
export type MatchSiteRuleInput = z.infer<typeof MatchSiteRuleInputSchema>;

export const MatchSiteRuleOutputSchema = z.object({
  matched: z.boolean(),
});
export type MatchSiteRuleOutput = z.infer<typeof MatchSiteRuleOutputSchema>;

function normalizeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function normalizeHostRule(rule: string): string {
  return rule.trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, '');
}

function hostnameMatchesRule(hostname: string, rule: string): boolean {
  const normalizedRule = normalizeHostRule(rule);
  if (!normalizedRule) return false;

  const normalizedHostname = hostname.toLowerCase();
  return (
    normalizedHostname === normalizedRule || normalizedHostname.endsWith(`.${normalizedRule}`)
  );
}

function urlPrefixMatchesRule(href: string, rule: string): boolean {
  const trimmed = rule.trim();
  if (!trimmed) return false;

  if (href.startsWith(trimmed)) return true;
  if (trimmed.endsWith('/')) return false;

  return href.startsWith(`${trimmed}/`);
}

function wildcardMatches(text: string, pattern: string): boolean {
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern.includes('*')) return false;

  const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`, 'i');
  return regex.test(text);
}

/**
 * Checks whether `rule` matches the given URL.
 *
 * Rule formats supported:
 * - Hostnames: `example.com` (matches subdomains)
 * - Host + path prefix: `example.com/path`
 * - URL prefix: `https://example.com/path`
 * - Wildcards: `*.example.com/*` or `*youtube*`
 *
 * This function is pure TS and relies only on the standard URL parser.
 */
export function matchSiteRule(input: MatchSiteRuleInput): MatchSiteRuleOutput {
  const urlObj = normalizeUrl(input.url);
  if (!urlObj) return { matched: false };

  const rule = input.rule.trim();
  if (!rule) return { matched: false };

  if (wildcardMatches(urlObj.href, rule) || wildcardMatches(urlObj.hostname, rule)) {
    return { matched: true };
  }

  if (rule.includes('://')) {
    return { matched: urlPrefixMatchesRule(urlObj.href, rule) };
  }

  const [hostPart, ...pathParts] = rule.split('/');
  const pathPart = pathParts.length > 0 ? `/${pathParts.join('/')}` : null;

  if (!hostnameMatchesRule(urlObj.hostname, hostPart ?? '')) return { matched: false };
  if (!pathPart) return { matched: true };

  return { matched: urlObj.pathname.startsWith(pathPart) };
}

export const IsUrlInSiteListInputSchema = z.object({
  url: z.string().min(1),
  sites: z.array(z.string()),
});
export type IsUrlInSiteListInput = z.infer<typeof IsUrlInSiteListInputSchema>;

export const IsUrlInSiteListOutputSchema = z.object({
  matched: z.boolean(),
  matchedRule: z.string().optional(),
});
export type IsUrlInSiteListOutput = z.infer<typeof IsUrlInSiteListOutputSchema>;

export function isUrlInSiteList(input: IsUrlInSiteListInput): IsUrlInSiteListOutput {
  for (const rule of input.sites) {
    if (!rule.trim()) continue;
    const matched = matchSiteRule({ url: input.url, rule }).matched;
    if (matched) return { matched: true, matchedRule: rule };
  }
  return { matched: false };
}

export const QualifySiteInputSchema = z.object({
  url: z.string().min(1),
  settings: SiteGateSettingsSchema,
});
export type QualifySiteInput = z.infer<typeof QualifySiteInputSchema>;

export const QualifySiteDecisionSchema = z.object({
  qualified: z.boolean(),
  reason: z.enum(['allowed', 'excluded', 'not_in_whitelist', 'invalid_url']),
  matchedRule: z.string().optional(),
});
export type QualifySiteDecision = z.infer<typeof QualifySiteDecisionSchema>;

export function qualifySite(input: QualifySiteInput): QualifySiteDecision {
  const urlObj = normalizeUrl(input.url);
  if (!urlObj) return { qualified: false, reason: 'invalid_url' };

  const excluded = isUrlInSiteList({ url: urlObj.href, sites: input.settings.excludedSites });
  if (excluded.matched) {
    return { qualified: false, reason: 'excluded', matchedRule: excluded.matchedRule };
  }

  if (input.settings.siteMode === 'whitelist') {
    const allowed = isUrlInSiteList({ url: urlObj.href, sites: input.settings.allowedSites });
    if (!allowed.matched) return { qualified: false, reason: 'not_in_whitelist' };
    return { qualified: true, reason: 'allowed', matchedRule: allowed.matchedRule };
  }

  return { qualified: true, reason: 'allowed' };
}

