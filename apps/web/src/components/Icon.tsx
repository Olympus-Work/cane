/** Font Awesome icon, rendered as a CSS class (the FA CSS is imported elsewhere). */
export function Icon({ name, family = 'solid', spin, className }: { name: string; family?: 'solid' | 'regular' | 'brands'; spin?: boolean; className?: string }) {
  const cls = [`fa-${family}`, `fa-${name}`];
  if (spin) cls.push('fa-spin');
  if (className) cls.push(className);
  return <i className={cls.join(' ')} aria-hidden="true" />;
}
