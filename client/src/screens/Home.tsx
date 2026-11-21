import { featureOn } from "../lib/model";
import { longDate } from "../lib/dates";
import { useOverviewData } from "../components/overview/data";
import "./Year.css";
import { Hello } from "../components/overview/Hello";
import { FocusToday } from "../components/overview/FocusToday";
import { Timeline } from "../components/overview/Timeline";
import { Today } from "../components/overview/Today";
import { Habits } from "../components/overview/Habits";
import { Streak } from "../components/overview/Streak";
import { Ahead } from "../components/overview/Ahead";
import { LastDays } from "../components/overview/LastDays";
import { Weeks } from "../components/overview/Weeks";
// the cards' own classes, so the blank placeholders take the same places in the grid
const LOADING = ["b-hello", "b-habits", "b-timeline", "b-today", "b-focus", "b-streak", "b-ahead", "b-recent", "b-heat"];
export function Home() {
  const data = useOverviewData();
  const { settings } = data;
  return (
    <>
      <div className="title-row">
        <h1>{data.T.homeTitle}</h1>
        <span className="sub">{longDate(data.t)}</span>
      </div>
      <div
        className={`home overview bento${featureOn(settings, "habits") ? "" : " no-habits"}${data.ready ? "" : " is-loading"}`}
        aria-busy={data.ready ? undefined : true}
      >
        {data.ready ? <>
        <Hello {...data} />
        {featureOn(settings, "habits") && <Habits {...data} />}
        <Timeline {...data} />
        <Today {...data} />
        <FocusToday {...data} />
        <Streak {...data} />
        <Ahead {...data} />
        <LastDays {...data} />
        <Weeks {...data} />
        </> : LOADING.filter((c) => c !== "b-habits" || featureOn(settings, "habits")).map((c) => <section key={c} className={`panel ${c}`} />)}
      </div>
    </>
  );
}
