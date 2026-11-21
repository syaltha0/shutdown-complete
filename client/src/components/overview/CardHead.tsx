import type { ReactNode } from 'react';

export function CardHead({ title, aside, id }: { title: ReactNode; aside?: ReactNode; id?: string }) {
  return <header className="b-head"><h2 id={id}>{title}</h2>{aside && <div className="b-head-aside">{aside}</div>}</header>;
}
