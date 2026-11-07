import './styles.css';

export function Button({ children, variant = 'primary', ...props }) {
  return <button className={`button button--${variant}`} {...props}>{children}</button>;
}

export function Badge({ children }) {
  return <span className="badge">{children}</span>;
}

export function TextField({ label, ...props }) {
  return <label className="field">{label}<input {...props} /></label>;
}

export function Avatar({ name }) {
  return <span className="avatar" aria-label={name}>{name.slice(0, 1)}</span>;
}

export function Notice({ children }) {
  return <p className="notice">✳ {children}</p>;
}
