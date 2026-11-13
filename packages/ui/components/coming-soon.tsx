const tones = {
  page: 'border border-line bg-raised px-2 font-semibold text-text-3',
  side: 'bg-side-hover px-1 font-regular text-side-text',
} as const;

export function ComingSoon(props: { readonly tone?: keyof typeof tones }) {
  return (
    <span
      class={`ml-auto shrink-0 rounded-full text-xs leading-normal whitespace-nowrap ${tones[props.tone ?? 'page']}`}
    >
      Coming Soon
    </span>
  );
}
