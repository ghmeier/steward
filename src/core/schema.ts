import { compareKeys, isRecord, sortedKeys } from "./data";

export type Schema<T> = {
	/**
	 * Appends "<path>: <message>" for every problem found and returns a freshly built value that
	 * shares no objects with the input. The return value means nothing once a problem was added.
	 */
	check(value: unknown, path: string, problems: string[]): T;
};

export type Infer<S> = S extends Schema<infer T> ? T : never;

type Shape = Record<string, Schema<unknown>>;
type Flat<T> = { [K in keyof T]: T[K] };
type Built<S extends Shape, O extends keyof S> = Flat<
	{ [K in Exclude<keyof S, O>]: Infer<S[K]> } & { [K in O]?: Infer<S[K]> }
>;

export function problemsOf<T>(
	schema: Schema<T>,
	value: unknown,
	path: string,
): string[] {
	const problems: string[] = [];
	schema.check(value, path, problems);
	return problems;
}

export function parse<T>(schema: Schema<T>, value: unknown, path: string): T {
	const problems: string[] = [];
	const result = schema.check(value, path, problems);
	if (problems.length > 0) throw new Error(problems.join("; "));
	return result;
}

function leaf<T>(
	expected: string,
	accepts: (value: unknown) => value is T,
	extra?: (value: T) => string | null,
): Schema<T> {
	return {
		check(value, path, problems) {
			const problem = accepts(value) ? (extra?.(value) ?? null) : expected;
			if (problem !== null) problems.push(`${path}: ${problem}`);
			return value as T;
		},
	};
}

export function integer(
	bounds: { min?: number; max?: number } = {},
): Schema<number> {
	return leaf(
		"must be an integer",
		(value): value is number => Number.isSafeInteger(value),
		(value) => {
			if (bounds.min !== undefined && value < bounds.min) {
				return `must be an integer of at least ${bounds.min}`;
			}
			if (bounds.max !== undefined && value > bounds.max) {
				return `must be an integer of at most ${bounds.max}`;
			}
			return null;
		},
	);
}

export function number(
	bounds: { min?: number; exclusiveMin?: number; max?: number } = {},
): Schema<number> {
	const bounded = leaf(
		"must be a finite number",
		(value): value is number =>
			typeof value === "number" && Number.isFinite(value),
		(value) => {
			if (bounds.min !== undefined && value < bounds.min) {
				return `must be at least ${bounds.min}`;
			}
			if (bounds.exclusiveMin !== undefined && value <= bounds.exclusiveMin) {
				return `must be above ${bounds.exclusiveMin}`;
			}
			if (bounds.max !== undefined && value > bounds.max) {
				return `must be at most ${bounds.max}`;
			}
			return null;
		},
	);
	return {
		check(value, path, problems) {
			const result = bounded.check(value, path, problems);
			// Negative zero is equal to zero but serializes differently, and state must never hold it.
			return Object.is(result, -0) ? 0 : result;
		},
	};
}

export function string(
	options: { nonEmpty?: boolean; pattern?: RegExp } = {},
): Schema<string> {
	return leaf(
		"must be a string",
		(value): value is string => typeof value === "string",
		(value) => {
			if (options.nonEmpty && value === "") return "must not be empty";
			if (options.pattern && !options.pattern.test(value)) {
				return `must match ${options.pattern}`;
			}
			return null;
		},
	);
}

export function literal<const V extends readonly string[]>(
	...values: V
): Schema<V[number]> {
	return leaf(
		`must be one of ${values.map((v) => `"${v}"`).join(", ")}`,
		(value): value is V[number] => values.includes(value as string),
	);
}

export function array<T>(
	item: Schema<T>,
	options: { minLength?: number } = {},
): Schema<T[]> {
	return {
		check(value, path, problems) {
			if (!Array.isArray(value)) {
				problems.push(`${path}: must be an array`);
				return [];
			}
			const min = options.minLength ?? 0;
			if (value.length < min) {
				problems.push(`${path}: must list at least ${min} items`);
			}
			return value.map((entry, index) =>
				item.check(entry, `${path}[${index}]`, problems),
			);
		},
	};
}

export function object<S extends Shape>(shape: S): Schema<Built<S, never>>;
export function object<S extends Shape, const O extends keyof S & string>(
	shape: S,
	options: { optional: readonly O[] },
): Schema<Built<S, O>>;
export function object(
	shape: Shape,
	options: { optional?: readonly string[] } = {},
): Schema<Record<string, unknown>> {
	const optional = options.optional ?? [];
	const shapeKeys = sortedKeys(shape);
	return {
		check(value, path, problems) {
			const result: Record<string, unknown> = {};
			if (!isRecord(value)) {
				problems.push(`${path}: must be an object`);
				return result;
			}
			// Sorting is deferred to the rare unknown-key case so valid input is never sorted, yet problem order stays deterministic.
			const unknown = Object.keys(value).filter(
				(key) => !Object.hasOwn(shape, key),
			);
			for (const key of unknown.sort(compareKeys)) {
				problems.push(`${path}.${key}: unknown key`);
			}
			for (const key of shapeKeys) {
				if (Object.hasOwn(value, key)) {
					result[key] = (shape[key] as Schema<unknown>).check(
						value[key],
						`${path}.${key}`,
						problems,
					);
				} else if (!optional.includes(key)) {
					problems.push(`${path}.${key}: is missing`);
				}
			}
			return result;
		},
	};
}

export function keyedBy<const K extends readonly string[], V>(
	keys: K,
	valueSchema: Schema<V>,
): Schema<Record<K[number], V>> {
	const shape: Shape = {};
	for (const key of keys) shape[key] = valueSchema;
	return object(shape) as unknown as Schema<Record<K[number], V>>;
}

export function record<V>(valueSchema: Schema<V>): Schema<Record<string, V>> {
	return {
		check(value, path, problems) {
			const result: Record<string, V> = {};
			if (!isRecord(value)) {
				problems.push(`${path}: must be an object`);
				return result;
			}
			for (const key of sortedKeys(value)) {
				result[key] = valueSchema.check(value[key], `${path}.${key}`, problems);
			}
			return result;
		},
	};
}

export function refine<T>(
	schema: Schema<T>,
	rule: (value: T, path: string, problems: string[]) => void,
): Schema<T> {
	return {
		check(value, path, problems) {
			const before = problems.length;
			const result = schema.check(value, path, problems);
			if (problems.length === before) rule(result, path, problems);
			return result;
		},
	};
}

export function custom<T>(
	parser: (value: unknown, path: string) => T,
): Schema<T> {
	return {
		check(value, path, problems) {
			try {
				return parser(value, path);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const carriesPath = [":", ".", "["].some((next) =>
					message.startsWith(path + next),
				);
				problems.push(carriesPath ? message : `${path}: ${message}`);
				return undefined as T;
			}
		},
	};
}

export function tuple<S extends readonly Schema<unknown>[]>(
	...items: S
): Schema<{ [K in keyof S]: Infer<S[K]> }> {
	return {
		check(value, path, problems) {
			if (!Array.isArray(value)) {
				problems.push(`${path}: must be an array`);
				return [] as never;
			}
			if (value.length !== items.length) {
				problems.push(`${path}: must list exactly ${items.length} items`);
			}
			return items.map((item, index) =>
				item.check(value[index], `${path}[${index}]`, problems),
			) as never;
		},
	};
}

export function variant<S extends Record<string, Schema<unknown>>>(
	tagKey: string,
	schemas: S,
): Schema<Infer<S[keyof S]>> {
	return {
		check(value, path, problems) {
			if (!isRecord(value)) {
				problems.push(`${path}: must be an object`);
				return {} as never;
			}
			const tag = value[tagKey];
			if (typeof tag !== "string" || !Object.hasOwn(schemas, tag)) {
				const expected = sortedKeys(schemas)
					.map((key) => `"${key}"`)
					.join(", ");
				problems.push(
					Object.hasOwn(value, tagKey)
						? `${path}.${tagKey}: must be one of ${expected}`
						: `${path}.${tagKey}: is missing`,
				);
				return {} as never;
			}
			return (schemas[tag] as Schema<unknown>).check(
				value,
				path,
				problems,
			) as never;
		},
	};
}

const MAX_LAZY_DEPTH = 64;

export function lazy<T>(resolve: () => Schema<T>): Schema<T> {
	// Parsing is synchronous, so one counter per schema tracks how deep the current check recurses.
	let depth = 0;
	let resolved: Schema<T> | undefined;
	return {
		check(value, path, problems) {
			if (depth >= MAX_LAZY_DEPTH) {
				problems.push(`${path}: nests deeper than ${MAX_LAZY_DEPTH} levels`);
				return undefined as T;
			}
			depth += 1;
			try {
				resolved ??= resolve();
				return resolved.check(value, path, problems);
			} finally {
				depth -= 1;
			}
		},
	};
}
