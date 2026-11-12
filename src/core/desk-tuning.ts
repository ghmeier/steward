import { z } from "zod";
import { addIssue } from "./errors";
import { normalizeZero } from "./math";
import { RESOURCES } from "./realm";
import {
  name,
  positiveInteger,
  repeatIssues,
  textWithPlaceholders,
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

const PARTY_PLACEHOLDERS = ["first", "second"];
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

const travellerOption = merchantOption.extend({
  newcomer: z.literal(true).exactOptional(),
});

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

function deskKind(
  option: z.ZodType<DeskOption>,
  placeholders: readonly string[],
) {
  return z.strictObject({
    weight: positiveInteger,
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
  weight: positiveInteger,
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
  arrival: z
    .strictObject({ minTicks: positiveInteger, maxTicks: positiveInteger })
    .superRefine((arrival, ctx) => {
      if (arrival.minTicks > arrival.maxTicks) {
        addIssue(ctx, "must not exceed maxTicks", ["minTicks"]);
      }
    }),
  grudgeTicks: positiveInteger,
  kinds: z.strictObject({
    dispute: deskKind(disputeOption, PARTY_PLACEHOLDERS),
    merchant: deskKind(merchantOption, NO_PLACEHOLDERS),
    traveller: deskKind(travellerOption, NO_PLACEHOLDERS),
    candidate: candidateKind,
    audit: auditKind,
  }),
});

export type DeskTuning = z.infer<typeof deskTuningSchema>;
export type DeskTemplate = Omit<
  z.infer<ReturnType<typeof deskTemplate>>,
  "expiry"
> & { expiry?: string };
