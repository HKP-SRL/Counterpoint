// Canonical JSON for approval digests (RESEARCH Item 4).
//
// One value has exactly one canonical text: object keys sorted by UTF-16 code unit (JavaScript's
// default string order), no whitespace, strings escaped exactly as JSON.stringify does, and only
// strings, safe integers, booleans, null, arrays and plain objects. Floats, NaN, Infinity, unsafe
// integers, undefined, functions, bigints, symbols and anything that is not a plain object are
// refused with the key path of the offending value, so a digest can never depend on how a number
// happens to print or on which keys a serializer silently drops.
//
// The same rules produce the pretty form used for the statement file on disk (`indent` > 0).

export class CanonicalJsonError extends Error {
  readonly path: string;

  constructor(path: string, what: string) {
    super(
      `${path} is ${what}; canonical JSON allows only strings, safe integers, booleans, null, arrays and objects.`,
    );
    this.name = 'CanonicalJsonError';
    this.path = path;
  }
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

function childPath(parent: string, key: string): string {
  return IDENTIFIER_RE.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function render(
  value: unknown,
  path: string,
  indent: number,
  depth: number,
  seen: Set<object>,
): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalJsonError(
          path,
          Number.isFinite(value)
            ? Number.isInteger(value)
              ? 'an unsafe integer'
              : 'a non-integer number'
            : 'not a finite number',
        );
      }
      // -0 prints as 0, like JSON.stringify.
      return String(value === 0 ? 0 : value);
    case 'object':
      break;
    default:
      throw new CanonicalJsonError(path, `of type ${typeof value}`);
  }

  if (seen.has(value)) throw new CanonicalJsonError(path, 'a circular reference');
  seen.add(value);
  try {
    const pad = indent > 0 ? `\n${' '.repeat(indent * (depth + 1))}` : '';
    const close = indent > 0 ? `\n${' '.repeat(indent * depth)}` : '';
    const colon = indent > 0 ? ': ' : ':';
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      const items: string[] = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) throw new CanonicalJsonError(`${path}[${i}]`, 'a hole');
        items.push(`${pad}${render(value[i], `${path}[${i}]`, indent, depth + 1, seen)}`);
      }
      return `[${items.join(',')}${close}]`;
    }
    if (!isPlainObject(value)) throw new CanonicalJsonError(path, 'not a plain object');
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return '{}';
    const members = keys.map((key) => {
      const child = childPath(path, key);
      return `${pad}${JSON.stringify(key)}${colon}${render(value[key], child, indent, depth + 1, seen)}`;
    });
    return `{${members.join(',')}${close}}`;
  } finally {
    seen.delete(value);
  }
}

/** The canonical JSON text of `value`. Errors name the key path, starting at `rootPath`. */
export function canonicalJson(value: unknown, rootPath = '$'): string {
  return render(value, rootPath, 0, 0, new Set());
}

/** The same value pretty-printed (sorted keys, `indent` spaces), without a trailing newline. */
export function prettyCanonicalJson(value: unknown, indent = 2, rootPath = '$'): string {
  return render(value, rootPath, indent, 0, new Set());
}
