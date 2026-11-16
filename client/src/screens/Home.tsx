import { useState } from "react";
import { featureOn } from "../lib/model";
import { longDate } from "../lib/dates";
import { useOverviewData } from "../components/overview/data";
import "./Year.css";
import { Hello } from "../components/overview/Hello";
import { FocusToday } from "../components/overview/FocusToday";
import { TasksToday } from "../components/overview/TasksToday";
import { Timeline } from "../components/overview/Timeline";
import { StillOpen } from "../components/overview/StillOpen";
import { Habits } from "../components/overview/Habits";
import { Streak } from "../components/overview/Streak";
import { Ahead } from "../components/overview/Ahead";
import { LastDays } from "../components/overview/LastDays";
import { Weeks } from "../components/overview/Weeks";
export function Home() {
  const [historyOpen, setHistoryOpen] = useState(() => { try { return localStorage.getItem('sc-home-history') === 'true'; } catch { return false; } });
  const data = useOverviewData();
  const { settings } = data;
  return (
    <>
      <div className="title-row">
        <h1>{data.T.homeTitle}</h1>
        <span className="sub">{longDate(data.t)}</span>
      </div>
      <div
        className={`home overview bento${featureOn(settings, "habits") ? "" : " no-habits"}`}
      >
        <Hello {...data} />
        <Timeline {...data} />
        <TasksToday {...data} />
        <StillOpen {...data} />
        <FocusToday {...data} />
        {featureOn(settings, "longTerm") && <Ahead {...data} />}
      </div>
      <details className="home-history" open={historyOpen} onToggle={e => { const open = e.currentTarget.open; setHistoryOpen(open); try { localStorage.setItem('sc-home-history', String(open)); } catch { /* unavailable storage */ } }}>
        <summary>{data.T.historyTitle}</summary>
        <div className="home bento history-grid">
          {featureOn(settings, "habits") && <Habits {...data} />}
          <Streak {...data} />
          <LastDays {...data} />
          {featureOn(settings, "longTerm") && <Weeks {...data} />}
        </div>
      </details>
    </>
  );
}
