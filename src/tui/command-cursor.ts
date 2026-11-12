import { copy } from "../core/copy";
import { DECREE_ID_PATTERN } from "../core/decree";
import { LaborSplit } from "../core/labor-split";
import { WORKING_JOBS } from "../core/realm";

export type Suggestion = { text: string; description: string };

const NUMBER = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/;
const NUMBER_PREFIX = /^-?\d*\.?\d*(e[+-]?\d*)?$/;

export type Choice<T> = {
  text: string;
  description: string;
  value: T;
  /** Set when this choice alone already ends a command, so an exact match is accepted like a final word. */
  final?: boolean;
};
/** A suggestion plus the whole line that accepting it produces, so tab never has to guess where the partial word began. */
export type Option = Suggestion & { completion: string };

/** Thrown when the text so far cannot go further: it is incomplete (suggestions) or wrong (problem). */
export class Halt extends Error {
  constructor(
    readonly options: Option[],
    readonly problem: string | null,
    readonly expecting: string | null,
  ) {
    super(problem ?? "incomplete");
  }
}

export type ExpectOptions = {
  /** The last word of the command: an exact match at the end of the text is accepted. */
  final?: boolean;
  unmatched?: (word: string) => string | null;
};

export class Cursor {
  private position = 0;
  // Set when the word just consumed could also begin a longer choice, so the next slot can offer both.
  private alternatives: Option[] = [];
  /** `text` has commas turned into spaces, so rules may be separated by a comma or nothing. */
  private readonly text: string;

  constructor(private readonly original: string) {
    this.text = original.replaceAll(",", " ");
  }

  private skipSpaces(): string {
    while (this.text[this.position] === " ") this.position += 1;
    return this.text.slice(this.position);
  }

  private optionFor(text: string, description: string): Option {
    const head = this.original.slice(0, this.position);
    return { text, description, completion: `${head}${text} ` };
  }

  expect<T>(
    expected: string,
    choices: readonly Choice<T>[],
    options: ExpectOptions = {},
  ): Choice<T> {
    const rest = this.skipSpaces();
    const offer = (list: readonly Choice<T>[]) =>
      list.map((choice) => this.optionFor(choice.text, choice.description));
    if (rest === "") {
      const extra = this.alternatives;
      this.alternatives = [];
      throw new Halt([...offer(choices), ...extra], null, null);
    }
    const matches = choices.filter(
      (choice) => rest === choice.text || rest.startsWith(`${choice.text} `),
    );
    const best = matches.reduce<Choice<T> | undefined>(
      (longest, choice) =>
        longest === undefined || choice.text.length > longest.text.length
          ? choice
          : longest,
      undefined,
    );
    const prefixed = choices.filter((choice) => choice.text.startsWith(rest));
    if (best === undefined) {
      if (prefixed.length > 0) throw new Halt(offer(prefixed), null, null);
      const word = rest.split(" ")[0] ?? rest;
      const problem =
        options.unmatched?.(word) ??
        copy.commandLine.notExpected({ word, expected });
      throw new Halt([], problem, null);
    }
    if (rest === best.text && !options.final && !best.final) {
      throw new Halt(offer(prefixed), null, null);
    }
    const trailing = rest.slice(best.text.length);
    if (trailing.trim() === "") {
      const longer = prefixed.filter((choice) => choice.text !== best.text);
      this.alternatives = offer(longer);
    }
    this.position += best.text.length;
    return best;
  }

  /** The last word of a command may be a finished number as it stands, since enter will not wait for more digits. */
  number(final = false): number {
    const rest = this.skipSpaces();
    if (rest === "") throw new Halt([], null, copy.commandLine.numberHelp);
    const word = rest.split(" ")[0] ?? rest;
    const typing = word.length === rest.length;
    if (typing && !(final && NUMBER.test(word)) && NUMBER_PREFIX.test(word)) {
      throw new Halt([], null, copy.commandLine.numberHelp);
    }
    const value = Number(word);
    if (!NUMBER.test(word) || !Number.isFinite(value)) {
      throw new Halt(
        [],
        copy.commandLine.notExpected({
          word,
          expected: copy.commandLine.expected.number,
        }),
        null,
      );
    }
    this.position += word.length;
    return value === 0 ? 0 : value;
  }

  /**
   * A labor split such as `farm 60 forest 30`, or null when the text is not one. A job followed by a
   * number starts a split, so a preset word alone, like `farm`, stays a preset. The last word of a
   * command may be a finished number as it stands, as with `number`. A command that ends in a split
   * has nothing after it to end the list, so any further word there must be a job.
   */
  laborSplit(final: boolean): string | null {
    const [first = "", second = ""] = this.skipSpaces().split(/ +/);
    if (!LaborSplit.isJob(first) || !/^[-\d.]/.test(second)) return null;

    const entries: [string, number][] = [];
    for (;;) {
      const job = this.skipSpaces().split(" ")[0] ?? "";
      if (!LaborSplit.isJob(job)) {
        return this.fail(copy.laborSplit.unknownJob({ job }));
      }
      this.position += job.length;
      entries.push([job, this.number(final)]);

      const rest = this.skipSpaces();
      const word = rest.split(" ")[0] ?? "";
      const unused = WORKING_JOBS.filter(
        (name) => !entries.some(([taken]) => taken === name),
      );
      const choices = unused.map((name) =>
        this.optionFor(name, copy.commandLine.jobHelp[name]),
      );
      if (rest === "") {
        this.alternatives = choices;
        break;
      }
      const typing = word.length === rest.length;
      const partial = choices.filter(
        (choice) => choice.text.startsWith(word) && choice.text !== word,
      );
      if (typing && partial.length > 0) throw new Halt(partial, null, null);
      if (!final && !LaborSplit.isJob(word)) break;
    }

    const split = LaborSplit.fromEntries(entries);
    if (!split.ok) return this.fail(split.problem);
    return split.split.format();
  }

  /** A free-text name; the text typed so far is accepted while it could still become a valid name. */
  name(help: string): string {
    const rest = this.skipSpaces();
    if (rest === "") throw new Halt([], null, help);
    const word = rest.split(" ")[0] ?? rest;
    const typing = word.length === rest.length;
    if (typing && DECREE_ID_PATTERN.test(word)) throw new Halt([], null, help);
    if (!DECREE_ID_PATTERN.test(word)) {
      throw new Halt([], copy.commandLine.invalidName({ word }), null);
    }
    this.position += word.length;
    return word;
  }

  fail(problem: string): never {
    throw new Halt([], problem, null);
  }

  finish(): void {
    const rest = this.skipSpaces();
    if (rest !== "") {
      this.fail(copy.commandLine.doesNotBelong({ rest }));
    }
  }
}
