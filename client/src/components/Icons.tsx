import { MARK } from '../lib/mark';
// One outline icon set, 1.5px stroke, drawn on a 20px box.
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** The planner's mark ("Signed off"); geometry in lib/mark.ts. The tick has pathLength 1 so it can be drawn in. */
export const Mark = () => (
  <svg viewBox={MARK.viewBox} aria-hidden="true" className="mark-svg">
    <g fill="none" strokeWidth={MARK.stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d={MARK.box} stroke="var(--text)" />
      <path className="mark-tick" d={MARK.tick} stroke="var(--hue)" pathLength={1} />
    </g>
  </svg>
);

export const IconDay = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <rect x="3" y="3.5" width="14" height="13.5" rx="2" />
    <path d="M3 7.5h14M7 2v3M13 2v3M6.5 10.5h4M6.5 13.5h7" />
  </svg>
);
export const IconWeek = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <rect x="3" y="3.5" width="14" height="13.5" rx="2" />
    <path d="M6.5 8h1M6.5 11h1M6.5 14h1M9.5 8h4M9.5 11h4M9.5 14h4" />
  </svg>
);
export const IconQuarter = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 3v7h7" />
  </svg>
);
export const IconMetrics = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <path d="M3 17h14M5.5 14V9M10 14V5M14.5 14v-3" />
  </svg>
);
export const IconShutdown = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <path d="M10 2.5v6.5M6 5.2a6 6 0 1 0 8 0" />
  </svg>
);
export const IconSettings = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <path d="M3 6h8M15 6h2M3 14h2M9 14h8" />
    <circle cx="13" cy="6" r="2" />
    <circle cx="7" cy="14" r="2" />
  </svg>
);
export const IconLeft = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M12 5l-5 5 5 5" /></svg>
);
export const IconRight = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M8 5l5 5-5 5" /></svg>
);
export const IconPlus = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M10 4v12M4 10h12" /></svg>
);
export const IconCalendar = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <rect x="3" y="4.5" width="14" height="12.5" rx="1.5" /><path d="M3 8.5h14M7 3v3M13 3v3M6.5 11.5h2M11.5 11.5h2M6.5 14h2" />
  </svg>
);
export const IconEye = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" /><circle cx="10" cy="10" r="2.5" />
  </svg>
);
export const IconEyeOff = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <path d="M8.2 4.7A8 8 0 0 1 10 4.5c5 0 8 5.5 8 5.5a14 14 0 0 1-2.2 2.9M5.6 6A13.6 13.6 0 0 0 2 10s3 5.5 8 5.5a7.7 7.7 0 0 0 3.8-1" />
    <path d="M8.3 8.3a2.5 2.5 0 0 0 3.4 3.4M3 3l14 14" />
  </svg>
);
export const IconX = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
);
export const IconRevise = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M4 6h9M4 10h5M12 10l4 4M16 10l-4 4" /></svg>
);
export const IconMonth = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <rect x="3" y="3.5" width="14" height="13.5" rx="2" />
    <path d="M3 7.5h14M7.7 7.5v9.5M12.3 7.5v9.5M3 10.7h14M3 13.9h14" />
  </svg>
);
export const IconFocus = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <circle cx="10" cy="11" r="6.5" />
    <path d="M10 7.5V11l2.2 1.6M8 2.5h4" />
  </svg>
);
export const IconHabits = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <rect x="3" y="3" width="5.5" height="5.5" rx="1.2" />
    <rect x="11.5" y="3" width="5.5" height="5.5" rx="1.2" />
    <rect x="3" y="11.5" width="5.5" height="5.5" rx="1.2" />
    <path d="M12 14.2l1.6 1.6 3-3.4" />
  </svg>
);
export const IconMore = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <circle cx="5" cy="10" r="1" /><circle cx="10" cy="10" r="1" /><circle cx="15" cy="10" r="1" />
  </svg>
);
export const IconPrint = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <path d="M6 7V3h8v4M6 14H4.5A1.5 1.5 0 0 1 3 12.5v-4A1.5 1.5 0 0 1 4.5 7h11A1.5 1.5 0 0 1 17 8.5v4a1.5 1.5 0 0 1-1.5 1.5H14" />
    <rect x="6" y="11" width="8" height="6" rx="1" />
  </svg>
);
export const IconGrip = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true"><g fill="currentColor"><circle cx="7.5" cy="5" r="1.3" /><circle cx="12.5" cy="5" r="1.3" /><circle cx="7.5" cy="10" r="1.3" /><circle cx="12.5" cy="10" r="1.3" /><circle cx="7.5" cy="15" r="1.3" /><circle cx="12.5" cy="15" r="1.3" /></g></svg>
);
export const IconTemplate = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><rect x="3" y="3" width="14" height="14" rx="2" /><path d="M6 7h8M6 10h5M6 13h6" /></svg>
);

export const IconRepeat = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <path d="M4.5 9.5a5.5 5.5 0 0 1 9.6-3.6L15.5 7.5M15.5 10.5a5.5 5.5 0 0 1-9.6 3.6L4.5 12.5M15.5 3.5v4h-4M4.5 16.5v-4h4" />
  </svg>
);

export const IconHome = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <path d="M3.5 9 10 3.5 16.5 9M5 7.8V16.5h3.5v-4.5h3v4.5H15V7.8" />
  </svg>
);

export const IconInbox = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <path d="M3 11.5V15a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 17 15v-3.5M3 11.5 5 4.5h10l2 7M3 11.5h4l1 2h4l1-2h4" />
  </svg>
);

export const IconHourglass = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <path d="M5.5 3h9M5.5 17h9M6.5 3c0 4 7 4 7 7s-7 3-7 7M13.5 3c0 4-7 4-7 7s7 3 7 7" />
  </svg>
);

export const IconBoard = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}>
    <rect x="3" y="3.5" width="4" height="13" rx="1.2" /><rect x="8.5" y="3.5" width="4" height="9" rx="1.2" /><rect x="14" y="3.5" width="3" height="6" rx="1.2" />
  </svg>
);

export const IconPencil = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M12.5 4.5l3 3L7 16H4v-3l8.5-8.5zM11 6l3 3" /></svg>
);
export const IconTag = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M3.5 4.5v5l7 7 6-6-7-7h-5z" /><circle cx="7" cy="7.5" r="1" /></svg>
);
export const IconStopwatch = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><circle cx="10" cy="11" r="6" /><path d="M8 2.5h4M10 2.5V5M10 11V8M15 5.5l1 -1" /></svg>
);
export const IconTasks = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><rect x="3" y="3" width="14" height="14" rx="2.5" /><path d="M6.5 10.2l2.4 2.4 4.6-5" /></svg>
);
export const IconNotes = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M4 5h12M4 8.5h12M4 12h12M4 15.5h7" /></svg>
);
export const IconSearch = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><circle cx="9" cy="9" r="5" /><path d="M13 13l3.5 3.5" /></svg>
);
export const IconDue = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.5 1.5" /></svg>
);
export const IconDown = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12" /></svg>
);
export const IconBell = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5l1.5 1.5h-12z" /><path d="M8.5 17h3" /></svg>
);
export const IconCopy = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><rect x="7" y="7" width="9.5" height="9.5" rx="2" /><path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6.5A1.5 1.5 0 0 0 5.5 13H7" /></svg>
);
export const IconTrash = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M4 6h12M8 6V4.5h4V6M5.5 6l.8 10h7.4l.8-10" /></svg>
);
export const IconSend = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M4 10h11M11 6l4 4-4 4" /></svg>
);
/** "Part of": an item tied to a plan one scale up. */
export const IconUp = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M6 14V6.5h7.5M6 6.5l8 8" /></svg>
);
/** "Broken down": the items one scale down that serve this one. */
export const IconBranch = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><circle cx="6" cy="5" r="1.6" /><circle cx="6" cy="15" r="1.6" /><circle cx="14" cy="15" r="1.6" /><path d="M6 6.6v6.8M6 10h5a3 3 0 0 1 3 3v.4" /></svg>
);
/** Steps of a task. */
export const IconSteps = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" {...P}><path d="M4 5h7M8 10h8M8 15h8M4 5v10h3M4 10h3" /></svg>
);
