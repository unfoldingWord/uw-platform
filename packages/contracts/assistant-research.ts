import { z } from 'zod';

export const RESEARCH_RESULTS_MOST = 10;
export const FLIGHT_OFFERS_MOST = 8;
export const WEB_ADDRESS_LONGEST = 2048;
export const WEB_PAGE_TEXT_MOST = 20_000;
export const WEB_REDIRECTS_MOST = 3;

export const assistantResearchKindSchema = z.enum([
  'web_search',
  'page_read',
  'page_rendered',
  'flight_search',
]);
export const assistantResearchRefusalSchema = z.enum([
  'research_capped',
  'address_blocked',
  'page_unreadable',
  'research_refused',
  'research_unavailable',
  'research_not_wired',
]);
export const webAddressRefusalSchema = z.enum([
  'not_web',
  'credentials',
  'port',
  'private_address',
  'too_long',
  'too_many_redirects',
]);
export const flightCabinSchema = z.enum(['economy', 'premium_economy', 'business', 'first']);

const airport = z.string().regex(/^[A-Z]{3}$/);
const fenced = z.string();

export const assistantResearchVerbIo = {
  search_web: {
    input: z.strictObject({
      query: z.string().trim().min(1).max(400),
      count: z.number().int().min(1).max(RESEARCH_RESULTS_MOST).optional(),
    }),
    output: z.object({
      results: z.array(z.object({ url: z.string(), details: fenced })).max(RESEARCH_RESULTS_MOST),
    }),
  },
  read_web_page: {
    input: z.strictObject({ url: z.string().trim().min(1).max(WEB_ADDRESS_LONGEST) }),
    output: z.object({
      url: z.string(),
      rendered: z.boolean(),
      truncated: z.boolean(),
      content: fenced,
    }),
  },
  find_flights: {
    input: z.strictObject({
      origin: airport,
      destination: airport,
      departDate: z.iso.date(),
      returnDate: z.iso.date().optional(),
      passengers: z.number().int().min(1).max(9).optional(),
      cabin: flightCabinSchema.optional(),
    }),
    output: z.object({
      offers: z
        .array(
          z.object({
            totalMinor: z.number().int().min(0),
            currency: z.string().regex(/^[A-Z]{3}$/),
            expiresAt: z.iso.datetime(),
            stops: z.number().int().min(0),
            durationMinutes: z.number().int().min(0),
            details: fenced,
          }),
        )
        .max(FLIGHT_OFFERS_MOST),
    }),
  },
};

export type AssistantResearchKind = z.infer<typeof assistantResearchKindSchema>;
export type AssistantResearchRefusal = z.infer<typeof assistantResearchRefusalSchema>;
export type WebAddressRefusal = z.infer<typeof webAddressRefusalSchema>;
export type FlightCabin = z.infer<typeof flightCabinSchema>;
