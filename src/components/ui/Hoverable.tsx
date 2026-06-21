import {
  useState,
  type CSSProperties,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type HTMLAttributes,
} from 'react';

/**
 * Primitives that reproduce the POC's `style-hover` / `style-focus` custom
 * attributes from the dc-runtime. Pass the base `style` plus an optional
 * `hoverStyle` / `focusStyle`; they are merged on top of the base while the
 * element is hovered / focused.
 */

type HButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  hoverStyle?: CSSProperties;
};

export function HButton({ style, hoverStyle, onMouseEnter, onMouseLeave, ...rest }: HButtonProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      {...rest}
      onMouseEnter={(e) => { setHover(true); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHover(false); onMouseLeave?.(e); }}
      style={hover && hoverStyle ? { ...style, ...hoverStyle } : style}
    />
  );
}

type HInputProps = InputHTMLAttributes<HTMLInputElement> & {
  focusStyle?: CSSProperties;
};

export function HInput({ style, focusStyle, onFocus, onBlur, ...rest }: HInputProps) {
  const [focus, setFocus] = useState(false);
  return (
    <input
      {...rest}
      onFocus={(e) => { setFocus(true); onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); onBlur?.(e); }}
      style={focus && focusStyle ? { ...style, ...focusStyle } : style}
    />
  );
}

type HTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  focusStyle?: CSSProperties;
};

export function HTextarea({ style, focusStyle, onFocus, onBlur, ...rest }: HTextareaProps) {
  const [focus, setFocus] = useState(false);
  return (
    <textarea
      {...rest}
      onFocus={(e) => { setFocus(true); onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); onBlur?.(e); }}
      style={focus && focusStyle ? { ...style, ...focusStyle } : style}
    />
  );
}

type HDivProps = HTMLAttributes<HTMLDivElement> & {
  hoverStyle?: CSSProperties;
};

export function HDiv({ style, hoverStyle, onMouseEnter, onMouseLeave, ...rest }: HDivProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      {...rest}
      onMouseEnter={(e) => { setHover(true); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHover(false); onMouseLeave?.(e); }}
      style={hover && hoverStyle ? { ...style, ...hoverStyle } : style}
    />
  );
}
