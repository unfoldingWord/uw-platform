type BuiltInView = { readonly id: string; readonly settings: unknown };

type BuiltInTemplate = {
  readonly id: string;
  readonly name: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly bodyMd: string;
};

export type BuiltIn = {
  readonly id: string;
  readonly definition: unknown;
  readonly views: readonly BuiltInView[];
  readonly templates?: readonly BuiltInTemplate[];
};
