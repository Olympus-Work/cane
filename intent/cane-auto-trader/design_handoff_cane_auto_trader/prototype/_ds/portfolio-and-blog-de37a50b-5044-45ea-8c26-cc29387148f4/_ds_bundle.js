/* @ds-bundle: {"format":3,"namespace":"PortfolioAndBlog_de37a5","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"ContactRow","sourcePath":"components/core/ContactRow.jsx"},{"name":"Field","sourcePath":"components/core/Field.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"ProjectCard","sourcePath":"components/core/ProjectCard.jsx"},{"name":"SectionHeading","sourcePath":"components/core/SectionHeading.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"d14b916a4747","components/core/Badge.jsx":"43007369d7cc","components/core/Button.jsx":"b194fefb8844","components/core/Card.jsx":"d668af329e14","components/core/ContactRow.jsx":"0d7d1af2f575","components/core/Field.jsx":"997edfd5b3a4","components/core/IconButton.jsx":"12948e6c1e13","components/core/ProjectCard.jsx":"ba4be339f770","components/core/SectionHeading.jsx":"ccf01cce0343","components/core/Tag.jsx":"c57e5b3519d3","ui_kits/blog/BlogIndex.jsx":"5fc665abcc7e","ui_kits/blog/PostView.jsx":"3b133fc108ae","ui_kits/blog/data.js":"a221e371b41a","ui_kits/portfolio/Chrome.jsx":"322e30d8d502","ui_kits/portfolio/HomeView.jsx":"d0abd476abee","ui_kits/portfolio/ProjectsView.jsx":"724a51bbbd0c","ui_kits/portfolio/data.js":"a91d0a5e3046"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.PortfolioAndBlog_de37a5 = window.PortfolioAndBlog_de37a5 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Avatar — circular profile image with the signature ink ring. Falls back to
 * initials if no src is provided.
 */
function Avatar({
  src,
  alt = '',
  initials,
  size = 64,
  ring = true,
  style,
  ...rest
}) {
  const base = {
    width: size,
    height: size,
    borderRadius: 'var(--radius-full)',
    objectFit: 'cover',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 'none',
    boxShadow: ring ? '0 0 0 4px var(--surface)' : 'none',
    background: 'var(--surface)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--weight-semibold)',
    fontSize: size * 0.38,
    overflow: 'hidden',
    ...style
  };
  if (src) {
    return /*#__PURE__*/React.createElement("img", _extends({
      src: src,
      alt: alt,
      width: size,
      height: size,
      style: base
    }, rest));
  }
  return /*#__PURE__*/React.createElement("span", _extends({
    style: base,
    role: "img",
    "aria-label": alt
  }, rest), initials);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Badge — a small categorical label. Soft-tinted pill in one of the brand's
 * semantic color families, optionally UPPERCASE for project categories.
 */
function Badge({
  children,
  color = 'indigo',
  // indigo | teal | amber | purple | rose | sky | green | blue | emerald | orange | red
  uppercase = false,
  icon,
  style,
  ...rest
}) {
  const families = {
    indigo: ['var(--indigo-100)', 'var(--indigo-800)'],
    teal: ['var(--teal-bg)', 'var(--teal-fg)'],
    amber: ['var(--amber-bg)', 'var(--amber-fg)'],
    purple: ['var(--purple-bg)', 'var(--purple-fg)'],
    rose: ['var(--rose-bg)', 'var(--rose-fg)'],
    sky: ['var(--sky-bg)', 'var(--sky-fg)'],
    green: ['var(--green-bg)', 'var(--green-fg)'],
    blue: ['var(--blue-bg)', 'var(--blue-fg)'],
    emerald: ['var(--emerald-bg)', 'var(--emerald-fg)'],
    orange: ['var(--orange-bg)', 'var(--orange-fg)'],
    red: ['var(--red-bg)', 'var(--red-fg)']
  };
  const [bg, fg] = families[color] || families.indigo;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      background: bg,
      color: fg,
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-xs)',
      fontWeight: 'var(--weight-semibold)',
      lineHeight: 1,
      padding: uppercase ? '5px 10px' : '4px 10px',
      borderRadius: 'var(--radius-full)',
      textTransform: uppercase ? 'uppercase' : 'none',
      letterSpacing: uppercase ? 'var(--tracking-wide)' : 'normal',
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), icon && /*#__PURE__*/React.createElement("i", {
    className: icon,
    "aria-hidden": "true"
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Button — the primary action control.
 * Indigo fill for primary, ink surface for secondary, transparent for ghost.
 */
function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  // Font Awesome class, e.g. "fas fa-paper-plane"
  iconRight,
  // Font Awesome class shown after the label
  block = false,
  disabled = false,
  type = 'button',
  onClick,
  style,
  ...rest
}) {
  const sizes = {
    sm: {
      padding: '8px 14px',
      fontSize: 'var(--text-sm)',
      gap: '6px'
    },
    md: {
      padding: '10px 18px',
      fontSize: 'var(--text-base)',
      gap: '8px'
    },
    lg: {
      padding: '14px 24px',
      fontSize: 'var(--text-lg)',
      gap: '10px'
    }
  };
  const variants = {
    primary: {
      background: 'var(--accent-strong)',
      color: 'var(--text-on-accent)',
      border: '1px solid transparent'
    },
    secondary: {
      background: 'var(--surface)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-strong)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-accent)',
      border: '1px solid transparent'
    }
  };
  const base = {
    display: block ? 'flex' : 'inline-flex',
    width: block ? '100%' : 'auto',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sizes[size].gap,
    padding: sizes[size].padding,
    fontSize: sizes[size].fontSize,
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--weight-semibold)',
    lineHeight: 1,
    borderRadius: 'var(--radius-sm)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
    whiteSpace: 'nowrap',
    ...variants[variant],
    ...style
  };
  const hoverBg = {
    primary: 'var(--accent-hover)',
    secondary: 'var(--surface-hover)',
    ghost: 'var(--accent-soft-bg)'
  }[variant];
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    style: base,
    onMouseEnter: e => {
      if (!disabled) e.currentTarget.style.background = hoverBg;
    },
    onMouseLeave: e => {
      if (!disabled) e.currentTarget.style.background = variants[variant].background;
    },
    onMouseDown: e => {
      if (!disabled) e.currentTarget.style.transform = 'translateY(1px)';
    },
    onMouseUp: e => {
      if (!disabled) e.currentTarget.style.transform = 'none';
    }
  }, rest), icon && /*#__PURE__*/React.createElement("i", {
    className: icon,
    "aria-hidden": "true"
  }), children, iconRight && /*#__PURE__*/React.createElement("i", {
    className: iconRight,
    "aria-hidden": "true"
  }));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Card — the surface primitive. Rounded-2xl panel with optional shadow and
 * hover lift. Use as the base for project cards, blog cards, contact panels.
 */
function Card({
  children,
  padding = 'var(--space-6)',
  hover = false,
  as = 'div',
  style,
  ...rest
}) {
  const Comp = as;
  const base = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-lg)',
    padding,
    overflow: 'hidden',
    transition: 'transform var(--dur-normal) var(--ease-out), box-shadow var(--dur-normal) var(--ease-out)',
    ...style
  };
  return /*#__PURE__*/React.createElement(Comp, _extends({
    style: base,
    onMouseEnter: e => {
      if (hover) {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-xl)';
      }
    },
    onMouseLeave: e => {
      if (hover) {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
      }
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/ContactRow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * ContactRow — an icon-chip + label/value row that links out. The signature
 * contact list item from the home page (hover-highlights the whole row).
 */
function ContactRow({
  icon,
  label,
  value,
  href,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("a", _extends({
    href: href,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      padding: 'var(--space-2)',
      borderRadius: 'var(--radius-sm)',
      textDecoration: 'none',
      transition: 'background var(--dur-fast) var(--ease-out)',
      ...style
    },
    onMouseEnter: e => {
      e.currentTarget.style.background = 'var(--bg-raised)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = 'transparent';
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 40,
      height: 40,
      flex: 'none',
      background: 'var(--surface)',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--text-primary)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: icon,
    "aria-hidden": "true"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-base)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--text-primary)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-secondary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, value)));
}
Object.assign(__ds_scope, { ContactRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/ContactRow.jsx", error: String((e && e.message) || e) }); }

// components/core/Field.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Field — labelled text input or textarea with the brand's focus ring.
 * Set `multiline` for a textarea.
 */
function Field({
  label,
  id,
  multiline = false,
  rows = 6,
  hint,
  icon,
  style,
  ...rest
}) {
  const [focused, setFocused] = React.useState(false);
  const controlStyle = {
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--bg-raised)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-base)',
    lineHeight: 'var(--leading-normal)',
    padding: icon ? '10px 14px 10px 40px' : '10px 14px',
    border: `1px solid ${focused ? 'var(--focus-ring)' : 'var(--border-strong)'}`,
    borderRadius: 'var(--radius-sm)',
    outline: 'none',
    boxShadow: focused ? '0 0 0 3px var(--accent-soft-bg)' : 'none',
    transition: 'border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)',
    resize: multiline ? 'vertical' : 'none',
    ...style
  };
  const Control = multiline ? 'textarea' : 'input';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--text-primary)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative'
    }
  }, icon && /*#__PURE__*/React.createElement("i", {
    className: icon,
    "aria-hidden": "true",
    style: {
      position: 'absolute',
      left: 14,
      top: multiline ? 14 : '50%',
      transform: multiline ? 'none' : 'translateY(-50%)',
      color: 'var(--text-muted)',
      fontSize: 'var(--text-sm)'
    }
  }), /*#__PURE__*/React.createElement(Control, _extends({
    id: id,
    rows: multiline ? rows : undefined,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    style: controlStyle
  }, rest))), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--text-muted)'
    }
  }, hint));
}
Object.assign(__ds_scope, { Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Field.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * IconButton — square, icon-only control. Used for nav toggles, social links,
 * and toolbar actions.
 */
function IconButton({
  icon,
  label,
  // accessible label (aria-label)
  variant = 'surface',
  // surface | ghost | accent
  size = 'md',
  href,
  onClick,
  style,
  ...rest
}) {
  const dims = {
    sm: 32,
    md: 40,
    lg: 48
  }[size];
  const font = {
    sm: 'var(--text-sm)',
    md: 'var(--text-base)',
    lg: 'var(--text-lg)'
  }[size];
  const variants = {
    surface: {
      background: 'var(--surface)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-secondary)',
      border: '1px solid transparent'
    },
    accent: {
      background: 'var(--accent-strong)',
      color: 'var(--text-on-accent)',
      border: '1px solid transparent'
    }
  };
  const hover = {
    surface: 'var(--surface-hover)',
    ghost: 'var(--accent-soft-bg)',
    accent: 'var(--accent-hover)'
  }[variant];
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: dims,
    height: dims,
    fontSize: font,
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)',
    ...variants[variant],
    ...style
  };
  const Comp = href ? 'a' : 'button';
  return /*#__PURE__*/React.createElement(Comp, _extends({
    href: href,
    onClick: onClick,
    "aria-label": label,
    title: label,
    style: base,
    onMouseEnter: e => {
      e.currentTarget.style.background = hover;
      if (variant === 'ghost') e.currentTarget.style.color = 'var(--text-accent)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = variants[variant].background;
      if (variant === 'ghost') e.currentTarget.style.color = 'var(--text-secondary)';
    }
  }, rest), /*#__PURE__*/React.createElement("i", {
    className: icon,
    "aria-hidden": "true"
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/SectionHeading.jsx
try { (() => {
/**
 * SectionHeading — an optional uppercase eyebrow, a heading, and an optional
 * supporting line. Centered or left-aligned. Used to open page sections.
 */
function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = 'left',
  // left | center
  size = 'md',
  // sm | md | lg
  style
}) {
  const titleSize = {
    sm: 'var(--text-2xl)',
    md: 'var(--text-3xl)',
    lg: 'var(--text-4xl)'
  }[size];
  const centered = align === 'center';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
      alignItems: centered ? 'center' : 'flex-start',
      textAlign: centered ? 'center' : 'left',
      maxWidth: subtitle ? '42rem' : 'none',
      marginLeft: centered ? 'auto' : undefined,
      marginRight: centered ? 'auto' : undefined,
      ...style
    }
  }, eyebrow && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-xs)',
      fontWeight: 'var(--weight-semibold)',
      textTransform: 'uppercase',
      letterSpacing: 'var(--tracking-wide)',
      color: 'var(--text-accent)'
    }
  }, eyebrow), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: titleSize,
      fontWeight: 'var(--weight-bold)',
      lineHeight: 'var(--leading-tight)',
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--text-primary)',
      textWrap: 'balance'
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-lg)',
      lineHeight: 'var(--leading-relaxed)',
      color: 'var(--text-secondary)',
      textWrap: 'pretty'
    }
  }, subtitle));
}
Object.assign(__ds_scope, { SectionHeading });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/SectionHeading.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Tag — a neutral "skill pill". Ink-surface capsule used for skills and
 * tech-stack chips. Adapts to light/dark via surface tokens.
 */
function Tag({
  children,
  icon,
  interactive = false,
  style,
  ...rest
}) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    background: 'var(--surface)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--weight-medium)',
    lineHeight: 1,
    padding: '8px 16px',
    borderRadius: 'var(--radius-full)',
    border: '1px solid var(--border)',
    whiteSpace: 'nowrap',
    transition: 'background var(--dur-fast) var(--ease-out)',
    cursor: interactive ? 'pointer' : 'default',
    ...style
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: base,
    onMouseEnter: e => {
      if (interactive) e.currentTarget.style.background = 'var(--surface-hover)';
    },
    onMouseLeave: e => {
      if (interactive) e.currentTarget.style.background = 'var(--surface)';
    }
  }, rest), icon && /*#__PURE__*/React.createElement("i", {
    className: icon,
    "aria-hidden": "true"
  }), children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/core/ProjectCard.jsx
try { (() => {
/**
 * ProjectCard — the signature portfolio card. A colored header (gradient + big
 * icon, or an image), a category badge, an icon+title row, a blurb, tech tags,
 * and a "read write-up" link. Composes Card + Badge + Tag.
 */
function ProjectCard({
  category,
  color = 'indigo',
  icon = 'fas fa-shield-halved',
  // header + title icon (Font Awesome)
  title,
  description,
  tags = [],
  // [{ label, color }]
  href = '#',
  image,
  // optional header image src (overrides gradient)
  style
}) {
  // Map color family -> gradient stops for the header
  const grad = {
    indigo: ['#6366f1', '#4338ca'],
    teal: ['#14b8a6', '#0f766e'],
    amber: ['#f59e0b', '#b45309'],
    purple: ['#a855f7', '#7e22ce'],
    rose: ['#f43f5e', '#be123c'],
    sky: ['#0ea5e9', '#0369a1'],
    green: ['#22c55e', '#15803d'],
    blue: ['#3b82f6', '#1d4ed8']
  }[color] || ['#6366f1', '#4338ca'];
  return /*#__PURE__*/React.createElement(__ds_scope.Card, {
    padding: "0",
    hover: true,
    as: "article",
    style: {
      display: 'flex',
      flexDirection: 'column',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 168,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: image ? `center/cover no-repeat url(${image})` : `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`,
      position: 'relative'
    }
  }, !image && /*#__PURE__*/React.createElement("i", {
    className: icon,
    "aria-hidden": "true",
    style: {
      color: '#fff',
      fontSize: 64,
      opacity: 0.95
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      padding: 'var(--space-6)',
      gap: 'var(--space-3)'
    }
  }, category && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    color: color,
    uppercase: true
  }, category)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: icon,
    "aria-hidden": "true",
    style: {
      color: 'var(--accent)',
      fontSize: 'var(--text-2xl)'
    }
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-xl)',
      fontWeight: 'var(--weight-bold)',
      lineHeight: 'var(--leading-snug)',
      color: 'var(--text-primary)'
    }
  }, title)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      lineHeight: 'var(--leading-relaxed)',
      color: 'var(--text-secondary)',
      flex: 1,
      textWrap: 'pretty'
    }
  }, description), tags.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 'var(--space-2)'
    }
  }, tags.map((t, i) => /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    key: i,
    color: t.color || color,
    style: {
      fontWeight: 'var(--weight-medium)'
    }
  }, t.label))), /*#__PURE__*/React.createElement("a", {
    href: href,
    style: {
      marginTop: 'var(--space-1)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      color: 'var(--text-accent)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--weight-semibold)',
      textDecoration: 'none'
    }
  }, "Read full write-up", /*#__PURE__*/React.createElement("i", {
    className: "fas fa-arrow-up-right-from-square",
    "aria-hidden": "true",
    style: {
      fontSize: 'var(--text-xs)'
    }
  }))));
}
Object.assign(__ds_scope, { ProjectCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/ProjectCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/blog/BlogIndex.jsx
try { (() => {
// Blog index — featured post + post list, on the signature dark surface.
const {
  Avatar,
  Badge,
  Card,
  IconButton,
  SectionHeading
} = window.PortfolioAndBlog_de37a5;
function BlogHeader() {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px clamp(16px, 4vw, 40px)',
      borderBottom: '1px solid var(--ink-600)',
      maxWidth: 'var(--container)',
      margin: '0 auto',
      width: '100%',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    src: "../../assets/profile-image.png",
    alt: "Wai Phyo Aung",
    size: 36
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      lineHeight: 1.2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 'var(--weight-bold)',
      color: 'var(--text-primary)'
    }
  }, "Waiphyo"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-mono)'
    }
  }, "blog.waiphyoaung.com"))), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      color: 'var(--text-accent)',
      fontWeight: 'var(--weight-bold)',
      fontSize: 'var(--text-sm)',
      textDecoration: 'none'
    }
  }, "Writing"), /*#__PURE__*/React.createElement("a", {
    href: "../portfolio/index.html",
    style: {
      color: 'var(--text-secondary)',
      fontWeight: 'var(--weight-bold)',
      fontSize: 'var(--text-sm)',
      textDecoration: 'none'
    }
  }, "Portfolio"), /*#__PURE__*/React.createElement(IconButton, {
    icon: "fas fa-rss",
    label: "RSS",
    variant: "surface",
    size: "sm"
  })));
}
function PostMeta({
  post,
  onSurface
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-mono)'
    }
  }, /*#__PURE__*/React.createElement("span", null, post.date), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\xB7"), /*#__PURE__*/React.createElement("span", null, post.read, " read"));
}
function BlogIndex({
  onOpen
}) {
  const posts = window.BLOG_POSTS;
  const featured = posts.find(p => p.featured) || posts[0];
  const rest = posts.filter(p => p !== featured);
  const grad = {
    indigo: ['#6366f1', '#4338ca'],
    teal: ['#14b8a6', '#0f766e'],
    amber: ['#f59e0b', '#b45309'],
    purple: ['#a855f7', '#7e22ce'],
    rose: ['#f43f5e', '#be123c'],
    sky: ['#0ea5e9', '#0369a1']
  };
  return /*#__PURE__*/React.createElement("main", {
    style: {
      maxWidth: 'var(--container)',
      margin: '0 auto',
      width: '100%',
      boxSizing: 'border-box',
      padding: 'var(--space-12) clamp(16px, 4vw, 40px)'
    }
  }, /*#__PURE__*/React.createElement(SectionHeading, {
    eyebrow: "Field notes",
    title: "Writing on security, in practice",
    subtitle: "Long-form write-ups from real migrations, deployments, and incidents \u2014 the detail the datasheets skip.",
    style: {
      marginBottom: 'var(--space-10)'
    }
  }), /*#__PURE__*/React.createElement(Card, {
    hover: true,
    padding: "0",
    as: "article",
    onClick: () => onOpen(featured),
    style: {
      cursor: 'pointer',
      marginBottom: 'var(--space-10)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)',
      minHeight: 240
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: `linear-gradient(135deg, ${grad[featured.color][0]}, ${grad[featured.color][1]})`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: featured.icon,
    "aria-hidden": "true",
    style: {
      color: '#fff',
      fontSize: 84,
      opacity: 0.95
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-8)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-2)',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    color: featured.color,
    uppercase: true
  }, featured.category), /*#__PURE__*/React.createElement(Badge, {
    color: "indigo"
  }, "Featured")), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 'var(--text-2xl)',
      fontWeight: 'var(--weight-bold)',
      lineHeight: 'var(--leading-snug)',
      color: 'var(--text-primary)'
    }
  }, featured.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--text-base)',
      lineHeight: 'var(--leading-relaxed)',
      color: 'var(--text-secondary)'
    }
  }, featured.excerpt), /*#__PURE__*/React.createElement(PostMeta, {
    post: featured
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: 'var(--space-6)'
    }
  }, rest.map(post => /*#__PURE__*/React.createElement(Card, {
    key: post.slug,
    hover: true,
    as: "article",
    onClick: () => onOpen(post),
    style: {
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 40,
      height: 40,
      flex: 'none',
      borderRadius: 'var(--radius-sm)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: `linear-gradient(135deg, ${grad[post.color][0]}, ${grad[post.color][1]})`,
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: post.icon,
    "aria-hidden": "true"
  })), /*#__PURE__*/React.createElement(Badge, {
    color: post.color,
    uppercase: true
  }, post.category)), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: 'var(--text-xl)',
      fontWeight: 'var(--weight-bold)',
      lineHeight: 'var(--leading-snug)',
      color: 'var(--text-primary)'
    }
  }, post.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--text-sm)',
      lineHeight: 'var(--leading-relaxed)',
      color: 'var(--text-secondary)',
      flex: 1
    }
  }, post.excerpt), /*#__PURE__*/React.createElement(PostMeta, {
    post: post
  })))));
}
Object.assign(window, {
  BlogHeader,
  BlogIndex,
  PostMeta
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/blog/BlogIndex.jsx", error: String((e && e.message) || e) }); }

// ui_kits/blog/PostView.jsx
try { (() => {
// Post reader — long-form article on a narrow reading column.
const {
  Avatar,
  Badge,
  Button,
  Tag
} = window.PortfolioAndBlog_de37a5;
function PostView({
  post,
  onBack
}) {
  return /*#__PURE__*/React.createElement("article", {
    style: {
      maxWidth: 'var(--container-sm)',
      margin: '0 auto',
      width: '100%',
      boxSizing: 'border-box',
      padding: 'var(--space-10) clamp(16px, 4vw, 24px) var(--space-16)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "fas fa-arrow-left",
    onClick: onBack,
    style: {
      marginBottom: 'var(--space-6)',
      padding: '6px 0'
    }
  }, "All writing"), /*#__PURE__*/React.createElement(Badge, {
    color: post.color,
    uppercase: true,
    style: {
      marginBottom: 'var(--space-4)'
    }
  }, post.category), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '0 0 var(--space-4)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-4xl)',
      fontWeight: 'var(--weight-bold)',
      lineHeight: 'var(--leading-tight)',
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--text-primary)',
      textWrap: 'balance'
    }
  }, post.title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      marginBottom: 'var(--space-8)',
      paddingBottom: 'var(--space-6)',
      borderBottom: '1px solid var(--ink-600)'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    src: "../../assets/profile-image.png",
    alt: "Wai Phyo Aung",
    size: 40
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      lineHeight: 1.3
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--text-primary)'
    }
  }, "Wai Phyo Aung"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-xs)',
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-mono)'
    }
  }, post.date, " \xB7 ", post.read, " read"))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-lg)',
      lineHeight: 'var(--leading-relaxed)',
      color: 'var(--text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: 0,
      color: 'var(--text-primary)'
    }
  }, post.excerpt), /*#__PURE__*/React.createElement("h2", {
    style: hStyle
  }, "The problem"), /*#__PURE__*/React.createElement("p", {
    style: pStyle
  }, "Every environment carries a decade of accumulated rules, exceptions, and \"temporary\" allowances nobody remembers writing. Before touching anything, we inventoried the real traffic \u2014 not the rulebase \u2014 and let evidence, not assumptions, drive the design."), /*#__PURE__*/React.createElement("h2", {
    style: hStyle
  }, "Baseline first"), /*#__PURE__*/React.createElement("p", {
    style: pStyle
  }, "We captured a known-good baseline and scoped the blast radius of every change. The rule that mattered most was the simplest one:"), /*#__PURE__*/React.createElement("pre", {
    style: preStyle
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#6b7280'
    }
  }, "# default-deny, then add back what the data proves we need"), '\n', /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#818cf8'
    }
  }, "set"), " rulebase security rules ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#a5b4fc'
    }
  }, "\"allow-known\""), " action allow", '\n', /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#818cf8'
    }
  }, "set"), " rulebase security rules ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#a5b4fc'
    }
  }, "\"deny-all\""), " action deny log-end yes"), /*#__PURE__*/React.createElement("div", {
    style: calloutStyle
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-circle-info",
    "aria-hidden": "true",
    style: {
      color: 'var(--text-accent)',
      marginTop: 3
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--text-base)',
      color: 'var(--text-primary)'
    }
  }, "Stage the cutover behind a feature flag you can flip in seconds. The ability to roll back instantly is what makes \"zero downtime\" credible.")), /*#__PURE__*/React.createElement("h2", {
    style: hStyle
  }, "Outcome"), /*#__PURE__*/React.createElement("p", {
    style: pStyle
  }, "The cutover landed inside the maintenance window with zero unplanned incidents, and the consolidated rulebase shrank by more than half \u2014 every surviving rule now traceable to observed traffic.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 'var(--space-2)',
      marginTop: 'var(--space-8)',
      paddingTop: 'var(--space-6)',
      borderTop: '1px solid var(--ink-600)'
    }
  }, /*#__PURE__*/React.createElement(Tag, null, post.category), /*#__PURE__*/React.createElement(Tag, null, "Defense in depth"), /*#__PURE__*/React.createElement(Tag, null, "Field notes")));
}
const hStyle = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-2xl)',
  fontWeight: 'var(--weight-bold)',
  color: 'var(--text-primary)',
  margin: 'var(--space-8) 0 var(--space-3)'
};
const pStyle = {
  margin: '0 0 var(--space-5)'
};
const preStyle = {
  background: 'var(--ink-900)',
  border: '1px solid var(--ink-600)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-4) var(--space-5)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-sm)',
  lineHeight: 1.7,
  color: '#e6edf3',
  overflowX: 'auto',
  margin: '0 0 var(--space-5)'
};
const calloutStyle = {
  display: 'flex',
  gap: 'var(--space-3)',
  alignItems: 'flex-start',
  background: 'var(--accent-soft-bg)',
  border: '1px solid var(--ink-600)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4) var(--space-5)',
  margin: '0 0 var(--space-5)',
  lineHeight: 'var(--leading-relaxed)'
};
Object.assign(window, {
  PostView
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/blog/PostView.jsx", error: String((e && e.message) || e) }); }

// ui_kits/blog/data.js
try { (() => {
// Blog content (the write-ups the portfolio links to).
const BLOG_POSTS = [{
  slug: 'enterprise-firewall-migration',
  category: 'Network Security',
  color: 'indigo',
  icon: 'fas fa-shield-halved',
  title: 'Migrating an Enterprise to Palo Alto NGFW — Zero Downtime',
  date: 'May 2026',
  read: '11 min',
  excerpt: 'How we consolidated a decade of legacy firewall rules, rolled out App-ID and User-ID, and cut over a multi-site enterprise without a single maintenance-window incident.',
  featured: true
}, {
  slug: 'siem-soc-deployment',
  category: 'Detection & Response',
  color: 'teal',
  icon: 'fas fa-chart-line',
  title: "Building a SIEM & SOC That Doesn't Cry Wolf",
  date: 'Apr 2026',
  read: '9 min',
  excerpt: 'Detection engineering for a banking environment: tuning out the noise, writing rules that map to MITRE ATT&CK, and the playbooks that closed our MTTR gap.'
}, {
  slug: 'vulnerability-management',
  category: 'Risk Management',
  color: 'amber',
  icon: 'fas fa-bug',
  title: 'A Risk-Based Vulnerability Management Program',
  date: 'Mar 2026',
  read: '8 min',
  excerpt: 'Scanning is the easy part. Here is how we prioritized by real risk, tracked SLAs, and turned a flood of CVEs into an executive report leadership actually read.'
}, {
  slug: 'zero-trust-rollout',
  category: 'Access Control',
  color: 'purple',
  icon: 'fas fa-user-lock',
  title: 'Rolling Out Zero Trust Without Breaking Everyone',
  date: 'Feb 2026',
  read: '10 min',
  excerpt: 'Identity-aware proxies, MFA everywhere, and least-privilege segmentation for a hybrid workforce — sequenced so the help desk did not revolt.'
}, {
  slug: 'edr-xdr-deployment',
  category: 'Detection & Response',
  color: 'rose',
  icon: 'fas fa-desktop',
  title: 'Cortex XDR in Production: Lessons Learned',
  date: 'Jan 2026',
  read: '7 min',
  excerpt: 'Custom prevention profiles, behavioral detections, and integrating endpoint response into existing SOC workflows — the parts the datasheet leaves out.'
}, {
  slug: 'cloud-security-posture',
  category: 'Cloud Security',
  color: 'sky',
  icon: 'fas fa-cloud',
  title: 'Cloud Security Posture: From Chaos to CSPM',
  date: 'Dec 2025',
  read: '9 min',
  excerpt: 'IAM least-privilege, secure landing zones, and continuous compliance across AWS and Azure — building a baseline that holds up under audit.'
}];
Object.assign(window, {
  BLOG_POSTS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/blog/data.js", error: String((e && e.message) || e) }); }

// ui_kits/portfolio/Chrome.jsx
try { (() => {
// Header + Footer shared across portfolio views.
const {
  Avatar,
  IconButton
} = window.PortfolioAndBlog_de37a5;
function PortfolioHeader({
  view,
  onNav,
  theme
}) {
  const dark = theme === 'dark';
  const border = dark ? 'var(--ink-600)' : 'var(--gray-200)';
  const link = (id, label) => {
    const active = view === id;
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      onClick: () => onNav(id),
      style: {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--weight-bold)',
        color: active ? 'var(--text-accent)' : 'var(--text-secondary)',
        padding: '4px 0'
      }
    }, label);
  };
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px clamp(16px, 4vw, 40px)',
      borderBottom: `1px solid ${border}`
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontWeight: 'var(--weight-bold)',
      fontSize: 'var(--text-base)',
      color: 'var(--text-primary)'
    }
  }, view === 'home' ? 'Home' : window.IDENTITY.name), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-6)'
    }
  }, link('home', 'Home'), link('projects', 'Projects'), /*#__PURE__*/React.createElement(IconButton, {
    icon: "fab fa-github",
    label: "GitHub",
    href: window.IDENTITY.social.github,
    size: "sm",
    variant: dark ? 'surface' : 'ghost'
  }), /*#__PURE__*/React.createElement(Avatar, {
    src: "../../assets/profile-image.png",
    alt: window.IDENTITY.name,
    size: 32
  })));
}
function PortfolioFooter({
  theme
}) {
  const dark = theme === 'dark';
  const border = dark ? 'var(--ink-600)' : 'var(--gray-200)';
  const socials = [['fab fa-github', 'GitHub', window.IDENTITY.social.github], ['fab fa-linkedin-in', 'LinkedIn', window.IDENTITY.social.linkedin], ['fab fa-youtube', 'YouTube', window.IDENTITY.social.youtube], ['fas fa-newspaper', 'Blog', window.IDENTITY.social.blog], ['fas fa-envelope', 'Email', 'mailto:' + window.IDENTITY.email]];
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      marginTop: 'auto',
      textAlign: 'center',
      padding: 'var(--space-8) var(--space-4)',
      borderTop: `1px solid ${border}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'center',
      gap: 'var(--space-5)',
      marginBottom: 'var(--space-3)'
    }
  }, socials.map(([icon, label, href]) => /*#__PURE__*/React.createElement(IconButton, {
    key: label,
    icon: icon,
    label: label,
    href: href,
    variant: "ghost",
    size: "sm"
  }))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-sm)',
      color: 'var(--text-muted)'
    }
  }, "\xA9 2026 ", window.IDENTITY.fullName, ". All rights reserved."));
}
Object.assign(window, {
  PortfolioHeader,
  PortfolioFooter
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/portfolio/Chrome.jsx", error: String((e && e.message) || e) }); }

// ui_kits/portfolio/HomeView.jsx
try { (() => {
// Home view — the dark landing page: profile, bio, skills, certs, contact.
const {
  Avatar,
  Tag,
  ContactRow,
  SectionHeading
} = window.PortfolioAndBlog_de37a5;
function HomeView() {
  const id = window.IDENTITY;
  return /*#__PURE__*/React.createElement("main", {
    style: {
      width: '100%',
      maxWidth: 'var(--container-sm)',
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: 'var(--space-12) clamp(16px, 4vw, 32px)'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    src: "../../assets/profile-image.png",
    alt: id.name,
    size: 144
  }), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 'var(--space-6) 0 4px',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-3xl)',
      fontWeight: 'var(--weight-bold)',
      color: 'var(--text-primary)',
      textAlign: 'center',
      letterSpacing: 'var(--tracking-tight)'
    }
  }, id.fullName), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 4px',
      color: 'var(--text-accent)',
      fontWeight: 'var(--weight-medium)'
    }
  }, id.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 var(--space-8)',
      color: 'var(--text-secondary)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: 'var(--text-sm)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-location-dot",
    "aria-hidden": "true",
    style: {
      fontSize: 'var(--text-xs)'
    }
  }), id.location), /*#__PURE__*/React.createElement("p", {
    style: {
      maxWidth: '40rem',
      margin: '0 0 var(--space-12)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-base)',
      lineHeight: 'var(--leading-relaxed)',
      color: 'var(--text-secondary)',
      textAlign: 'justify',
      textAlignLast: 'left'
    }
  }, "A cybersecurity professional with 6+ years of experience securing networks, systems, and applications in enterprise, banking, telecom, and campus environments. Certified in CCNA, CompTIA CSAP, Blue Coat ProxySG, PCNSE, and PCDRA; adept at architecting resilient cyber-defense strategies, conducting vulnerability assessments, and leading incident response."), /*#__PURE__*/React.createElement("section", {
    style: {
      width: '100%',
      marginBottom: 'var(--space-10)'
    }
  }, /*#__PURE__*/React.createElement(SectionHeading, {
    title: "Skills",
    size: "sm",
    style: {
      marginBottom: 'var(--space-4)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 'var(--space-3)'
    }
  }, window.SKILLS.map(s => /*#__PURE__*/React.createElement(Tag, {
    key: s,
    interactive: true
  }, s)))), /*#__PURE__*/React.createElement("section", {
    style: {
      width: '100%',
      marginBottom: 'var(--space-10)'
    }
  }, /*#__PURE__*/React.createElement(SectionHeading, {
    title: "Certifications",
    size: "sm",
    style: {
      marginBottom: 'var(--space-4)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
      gap: 'var(--space-3)'
    }
  }, window.CERTS.map(c => /*#__PURE__*/React.createElement("div", {
    key: c,
    style: {
      background: 'var(--surface)',
      borderRadius: 'var(--radius-sm)',
      padding: 'var(--space-3)',
      textAlign: 'center',
      border: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "fas fa-certificate",
    "aria-hidden": "true",
    style: {
      color: 'var(--text-accent)',
      marginBottom: 6,
      display: 'block'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-sm)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--text-primary)'
    }
  }, c))))), /*#__PURE__*/React.createElement("section", {
    style: {
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement(SectionHeading, {
    title: "Contact",
    size: "sm",
    style: {
      marginBottom: 'var(--space-4)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    }
  }, /*#__PURE__*/React.createElement(ContactRow, {
    icon: "fas fa-envelope",
    label: "Email",
    value: id.email,
    href: 'mailto:' + id.email
  }), /*#__PURE__*/React.createElement(ContactRow, {
    icon: "fab fa-linkedin-in",
    label: "LinkedIn",
    value: "linkedin.com/in/wai-phyo-aung",
    href: id.social.linkedin
  }), /*#__PURE__*/React.createElement(ContactRow, {
    icon: "fab fa-github",
    label: "GitHub",
    value: "github.com/waiphyoaung",
    href: id.social.github
  }), /*#__PURE__*/React.createElement(ContactRow, {
    icon: "fab fa-youtube",
    label: "YouTube",
    value: "youtube.com/@waiphyoaung",
    href: id.social.youtube
  }), /*#__PURE__*/React.createElement(ContactRow, {
    icon: "fas fa-newspaper",
    label: "Blog",
    value: "blog.waiphyoaung.com",
    href: id.social.blog
  }))));
}
Object.assign(window, {
  HomeView
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/portfolio/HomeView.jsx", error: String((e && e.message) || e) }); }

// ui_kits/portfolio/ProjectsView.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Projects view — the light page: about, featured project grid, contact form.
const {
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  ProjectCard,
  SectionHeading
} = window.PortfolioAndBlog_de37a5;
function ProjectsView() {
  const id = window.IDENTITY;
  const [sent, setSent] = React.useState(false);
  return /*#__PURE__*/React.createElement("main", {
    style: {
      width: '100%',
      maxWidth: 'var(--container)',
      margin: '0 auto',
      padding: 'var(--space-12) clamp(16px, 4vw, 40px)'
    }
  }, /*#__PURE__*/React.createElement("section", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 'var(--space-12)',
      alignItems: 'center',
      marginBottom: 'var(--space-24)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '1 1 320px'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 var(--space-4)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-4xl)',
      fontWeight: 'var(--weight-bold)',
      color: 'var(--text-primary)',
      letterSpacing: 'var(--tracking-tight)'
    }
  }, "About Me"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 var(--space-4)',
      fontSize: 'var(--text-lg)',
      lineHeight: 'var(--leading-relaxed)',
      color: 'var(--text-secondary)'
    }
  }, "I'm a full-stack security practitioner \u2014 architecting defenses across network, application, cloud and DevSecOps layers using firewalls, SIEM, EDR, vulnerability scans, MFA and zero-trust principles."), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 var(--space-6)',
      fontSize: 'var(--text-lg)',
      lineHeight: 'var(--leading-relaxed)',
      color: 'var(--text-secondary)'
    }
  }, "In my personal time, I build home labs, benchmark new security tools, and enjoy technical reading with a good coffee."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 'var(--space-2)'
    }
  }, window.CERTS.map(c => /*#__PURE__*/React.createElement(Badge, {
    key: c,
    color: "indigo"
  }, c)))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '0 0 auto',
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    src: "../../assets/profile-image.png",
    alt: id.name,
    size: 224
  }))), /*#__PURE__*/React.createElement("section", {
    style: {
      marginBottom: 'var(--space-24)'
    }
  }, /*#__PURE__*/React.createElement(SectionHeading, {
    eyebrow: "Selected work",
    title: "Featured Projects",
    subtitle: "Selected cybersecurity work \u2014 each card links to a full write-up on my blog.",
    align: "center",
    style: {
      marginBottom: 'var(--space-12)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: 'var(--space-8)'
    }
  }, window.PROJECTS.map(p => /*#__PURE__*/React.createElement(ProjectCard, _extends({
    key: p.title
  }, p))))), /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement(SectionHeading, {
    title: "Get in Touch",
    subtitle: "Write a quick subject and message \u2014 it opens in your email client.",
    align: "center",
    style: {
      marginBottom: 'var(--space-10)'
    }
  }), /*#__PURE__*/React.createElement(Card, {
    as: "form",
    style: {
      maxWidth: 'var(--container-sm)',
      margin: '0 auto'
    },
    onSubmit: e => {
      e.preventDefault();
      setSent(true);
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Subject",
    id: "subject",
    placeholder: "Project inquiry",
    icon: "fas fa-tag"
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Message",
    id: "message",
    multiline: true,
    rows: 5,
    placeholder: "Tell me about your project..."
  }), /*#__PURE__*/React.createElement(Button, {
    type: "submit",
    variant: "primary",
    block: true,
    icon: "fas fa-paper-plane"
  }, sent ? 'Thanks — opening your email…' : 'Open in Email'), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      textAlign: 'center',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-muted)'
    }
  }, "Prefer no mail client?", ' ', /*#__PURE__*/React.createElement("a", {
    href: 'mailto:' + id.email,
    style: {
      color: 'var(--text-accent)'
    }
  }, id.email))))));
}
Object.assign(window, {
  ProjectsView
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/portfolio/ProjectsView.jsx", error: String((e && e.message) || e) }); }

// ui_kits/portfolio/data.js
try { (() => {
// Shared identity + project data (mirrors Portfolio/JS/config.js).
const IDENTITY = {
  name: 'Wai Phyo Aung',
  fullName: 'Wai Phyo Aung – Waiphyo',
  title: 'Cyber Security Specialist',
  location: 'Bangkok, Thailand',
  email: 'waiphyo00297@gmail.com',
  social: {
    github: 'https://github.com/waiphyoaung',
    linkedin: 'https://www.linkedin.com/in/wai-phyo-aung-41b070148/',
    youtube: 'https://www.youtube.com/@waiphyoaung',
    blog: 'https://blog.waiphyoaung.com'
  }
};
const SKILLS = ['Network Security', 'Vulnerability Assessment', 'Incident Response', 'Security Architecture', 'Policy & Compliance', 'Risk Management', 'SIEM / Log Analysis', 'Cloud Security', 'Firewall (Palo Alto, FortiGate)', 'EDR / XDR', 'Zero Trust'];
const CERTS = ['CCNA', 'CompTIA CSAP', 'Blue Coat ProxySG', 'PCNSE', 'PCDRA'];
const PROJECTS = [{
  category: 'Network Security',
  color: 'indigo',
  icon: 'fas fa-shield-halved',
  title: 'Enterprise Firewall Migration',
  description: 'Led migration from legacy firewalls to Palo Alto NGFW across a multi-site enterprise — policy consolidation, App-ID/User-ID rollout, zero-downtime cutover.',
  tags: [{
    label: 'Palo Alto'
  }, {
    label: 'NGFW',
    color: 'green'
  }, {
    label: 'Panorama',
    color: 'amber'
  }],
  href: 'https://blog.waiphyoaung.com/enterprise-firewall-migration'
}, {
  category: 'Detection & Response',
  color: 'teal',
  icon: 'fas fa-chart-line',
  title: 'SIEM & SOC Deployment',
  description: 'Designed and tuned SIEM pipelines, detection rules and SOC playbooks for a banking environment — reducing alert fatigue and closing MTTR gaps.',
  tags: [{
    label: 'SIEM'
  }, {
    label: 'SOC',
    color: 'orange'
  }, {
    label: 'Threat Hunting',
    color: 'purple'
  }],
  href: 'https://blog.waiphyoaung.com/siem-soc-deployment'
}, {
  category: 'Risk Management',
  color: 'amber',
  icon: 'fas fa-bug',
  title: 'Vulnerability Management',
  description: 'Built an end-to-end vulnerability management program — discovery, risk-based prioritization, SLA tracking and executive reporting.',
  tags: [{
    label: 'Nessus'
  }, {
    label: 'Qualys',
    color: 'blue'
  }, {
    label: 'CVSS',
    color: 'red'
  }],
  href: 'https://blog.waiphyoaung.com/vulnerability-management'
}, {
  category: 'Access Control',
  color: 'purple',
  icon: 'fas fa-user-lock',
  title: 'Zero-Trust Rollout',
  description: 'Implemented zero-trust network access with identity-aware proxies, MFA, and least-privilege segmentation across a hybrid workforce.',
  tags: [{
    label: 'ZTNA'
  }, {
    label: 'MFA',
    color: 'indigo'
  }, {
    label: 'Segmentation',
    color: 'green'
  }],
  href: 'https://blog.waiphyoaung.com/zero-trust-rollout'
}, {
  category: 'Detection & Response',
  color: 'rose',
  icon: 'fas fa-desktop',
  title: 'EDR / XDR Deployment',
  description: 'Rolled out Cortex XDR across endpoints & servers — custom prevention profiles, behavioral detections, and IR runbooks integrated with SOC workflows.',
  tags: [{
    label: 'Cortex XDR'
  }, {
    label: 'EDR',
    color: 'blue'
  }, {
    label: 'IR Playbooks'
  }],
  href: 'https://blog.waiphyoaung.com/edr-xdr-deployment'
}, {
  category: 'Cloud Security',
  color: 'sky',
  icon: 'fas fa-cloud',
  title: 'Cloud Security Posture',
  description: 'Hardened multi-cloud workloads — IAM least-privilege, CSPM baselines, secure landing zones, and continuous compliance monitoring.',
  tags: [{
    label: 'AWS'
  }, {
    label: 'Azure',
    color: 'blue'
  }, {
    label: 'CSPM',
    color: 'emerald'
  }],
  href: 'https://blog.waiphyoaung.com/cloud-security-posture'
}];
Object.assign(window, {
  IDENTITY,
  SKILLS,
  CERTS,
  PROJECTS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/portfolio/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.ContactRow = __ds_scope.ContactRow;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.ProjectCard = __ds_scope.ProjectCard;

__ds_ns.SectionHeading = __ds_scope.SectionHeading;

__ds_ns.Tag = __ds_scope.Tag;

})();
