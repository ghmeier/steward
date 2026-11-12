import { z } from "zod";
import { addIssue } from "./errors";
import { normalizeZero } from "./math";
import { RESOURCES } from "./realm";
import {
  name,
  positive,
  positiveInteger,
  repeatIssues,
  textWithPlaceholders,
  tickRange,
} from "./schema";

const amount = z.number().transform(normalizeZero).exactOptional();

const optionResources = z
  .strictObject({
    coin: amount,
    grain: amount,
    ore: amount,
    wood: amount,
  })
  .exactOptional();

/** A desk entry's parties fill these placeholders in order. */
export const PARTY_PLACEHOLDERS = ["first", "second"];
const PETITIONER_PLACEHOLDERS = ["first"];
const CANDIDATE_PLACEHOLDERS = ["name", "village", "price", "job", "traits"];
const NO_PLACEHOLDERS: string[] = [];

function deskOption(placeholders: readonly string[]) {
  return z.strictObject({
    id: name,
    label: textWithPlaceholders(placeholders),
    resources: optionResources,
  });
}

const disputeOption = deskOption(PARTY_PLACEHOLDERS).extend({
  grudge: z.enum(["first", "second"]).exactOptional(),
});

const merchantOption = deskOption(NO_PLACEHOLDERS);

const newcomer = z.literal(true).exactOptional();

// A petition names one peasant, so only the first party can sulk.
const petitionOption = deskOption(PETITIONER_PLACEHOLDERS).extend({
  grudge: z.literal("first").exactOptional(),
  newcomer,
});

const travellerOption = merchantOption.extend({ newcomer });

const computedCostOption = <Id extends string>(
  id: Id,
  placeholders: readonly string[],
) =>
  z.strictObject({
    id: z.literal(id),
    label: textWithPlaceholders(placeholders),
    // Declared so every kind's option reads alike, but never allowed: the cost is computed from the entry or the books.
    resources: z.never().exactOptional(),
  });

const auditOption = <Id extends string>(id: Id) => computedCostOption(id, []);

const candidateOption = <Id extends string>(id: Id) =>
  computedCostOption(id, CANDIDATE_PLACEHOLDERS);

// Every kind's option is read through this one shape, so the fields only some kinds have are optional here.
export type DeskOption = z.infer<typeof merchantOption> &
  Partial<
    Pick<z.infer<typeof disputeOption>, "grudge"> &
      Pick<z.infer<typeof travellerOption>, "newcomer">
  >;

function deskTemplate(
  option: z.ZodType<DeskOption>,
  placeholders: readonly string[],
) {
  return z
    .strictObject({
      id: name,
      text: textWithPlaceholders(placeholders),
      options: z.array(option).min(2),
      expiry: z.string(),
      expired: textWithPlaceholders(placeholders),
    })
    .superRefine((template, ctx) => {
      repeatIssues(
        template.options.map((candidate) => candidate.id),
        "option id",
        ctx,
        ["options"],
      );
      const expiry = template.options.find(
        (candidate) => candidate.id === template.expiry,
      );
      if (expiry === undefined) {
        addIssue(ctx, "must name one of its options", ["expiry"]);
        return;
      }
      if (expiry.grudge !== undefined) {
        addIssue(ctx, `option "${expiry.id}" must not grudge`, ["expiry"]);
      }
      if (expiry.newcomer !== undefined) {
        addIssue(ctx, `option "${expiry.id}" must not add a peasant`, [
          "expiry",
        ]);
      }
      for (const resource of RESOURCES) {
        if ((expiry.resources?.[resource] ?? 0) > 0) {
          addIssue(ctx, `option "${expiry.id}" must not gain ${resource}`, [
            "expiry",
          ]);
        }
      }
    });
}

const kindGate = {
  weight: positiveInteger,
  // A kind with an unlock is only drawn once the player owns that unlock.
  unlock: name.exactOptional(),
};

function deskKind(
  option: z.ZodType<DeskOption>,
  placeholders: readonly string[],
) {
  return z.strictObject({
    ...kindGate,
    templates: z
      .array(deskTemplate(option, placeholders))
      .min(1)
      .superRefine((templates, ctx) =>
        repeatIssues(
          templates.map((template) => template.id),
          "id",
          ctx,
        ),
      ),
  });
}

// An audit's options cost whatever the debt is when it is settled, so the template holds no amounts, and
// it has no expiry option because failing the deadline is not something the player picks.
const auditTemplate = z.strictObject({
  id: name,
  text: textWithPlaceholders(NO_PLACEHOLDERS),
  options: z.tuple([auditOption("back"), auditOption("deepen")]),
  expired: textWithPlaceholders(NO_PLACEHOLDERS),
});

// A candidate's price is on the entry, so its options hold no amounts; the only way out without hiring is passing.
const candidateTemplate = z.strictObject({
  id: name,
  text: textWithPlaceholders(CANDIDATE_PLACEHOLDERS),
  options: z.tuple([candidateOption("hire"), candidateOption("pass")]),
  expiry: z.literal("pass"),
  expired: textWithPlaceholders(CANDIDATE_PLACEHOLDERS),
});

const candidateKind = z.strictObject({
  ...kindGate,
  templates: z
    .array(candidateTemplate)
    .min(1)
    .superRefine((templates, ctx) =>
      repeatIssues(
        templates.map((template) => template.id),
        "id",
        ctx,
      ),
    ),
});

const auditKind = z.strictObject({
  templates: z
    .array(auditTemplate)
    .min(1)
    .superRefine((templates, ctx) =>
      repeatIssues(
        templates.map((template) => template.id),
        "id",
        ctx,
      ),
    ),
});

export const deskTuningSchema = z.strictObject({
  slots: positiveInteger,
  arrival: tickRange,
  grudgeTicks: positiveInteger,
  scale: z.strictObject({
    /** Option amounts are multiplied by the realm's population over this, and never by less than one. */
    perPopulation: positive,
    /** A traveller brings one newcomer for each this many people in the realm, rounded up. */
    newcomersPer: positive,
  }),
  kinds: z.strictObject({
    dispute: deskKind(disputeOption, PARTY_PLACEHOLDERS),
    merchant: deskKind(merchantOption, NO_PLACEHOLDERS),
    traveller: deskKind(travellerOption, NO_PLACEHOLDERS),
    petition: deskKind(petitionOption, PETITIONER_PLACEHOLDERS),
    omen: deskKind(merchantOption, NO_PLACEHOLDERS),
    candidate: candidateKind,
    audit: auditKind,
  }),
});

export type DeskTuning = z.infer<typeof deskTuningSchema>;
export type DeskTemplate = Omit<
  z.infer<ReturnType<typeof deskTemplate>>,
  "expiry"
> & { expiry?: string };
