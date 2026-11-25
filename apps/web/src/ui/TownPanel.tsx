import type {
  ResidentKind,
  TownFrame,
  TownResident,
  TownShop,
} from "@herdr-office/core";
import { useLayoutEffect, useRef } from "react";

export type TownSelection =
  | { kind: "news" }
  | { kind: "shop" | "resident"; id: string };

const statusLabels = {
  open: "영업 중",
  closed: "영업 종료",
  vacant: "빈 점포",
};
const storyLabels = {
  opening: "개업",
  closure: "폐업",
  event: "행사",
  company: "캠퍼스",
  weather: "날씨",
  local: "동네 소식",
};
const activityLabels: Record<ResidentKind | "delivery", string> = {
  home: "집에서 쉬는 중",
  walk: "이동 중",
  work: "일하는 중",
  school: "학교에 있는 중",
  shop: "장 보는 중",
  park: "공원에서 쉬는 중",
  festival: "동네 행사에 참여 중",
  rest: "쉬는 중",
  delivery: "상품 배달 중",
};
const ageLabels = {
  child: "어린이",
  young: "청년",
  adult: "성인",
  senior: "어르신",
};
const won = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
});
const hours = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

function ShopDetails({ shop }: { shop: TownShop }) {
  return (
    <>
      <p className="town-detail-subtitle">
        {statusLabels[shop.status]}
        {shop.kind && ` · ${hours(shop.opensAt)}–${hours(shop.closesAt)}`}
      </p>
      {shop.kind && (
        <>
          <dl className="town-details">
            <div>
              <dt>주인</dt>
              <dd>{shop.owner ?? "미정"}</dd>
            </div>
            <div>
              <dt>오늘 매출</dt>
              <dd>{won.format(shop.todaySales)}</dd>
            </div>
            {shop.staff.length > 0 && (
              <div>
                <dt>직원</dt>
                <dd>{shop.staff.join(", ")}</dd>
              </div>
            )}
          </dl>
          <h3>메뉴</h3>
          <ul className="town-menu">
            {shop.menu.map((item) => (
              <li key={item.id}>
                <span>{item.name}</span>
                <span>
                  {item.stock === 0 ? "품절" : won.format(item.price)}
                </span>
              </li>
            ))}
          </ul>
          <h3>단골 직원</h3>
          <p>
            {shop.regulars.length > 0
              ? shop.regulars.join(", ")
              : "아직 등록된 단골이 없습니다."}
          </p>
          {shop.greeting && <p className="town-greeting">“{shop.greeting}”</p>}
          {shop.deliveryAt && <p>상품 납품 예정</p>}
        </>
      )}
    </>
  );
}

function ResidentDetails({
  resident,
  at,
}: {
  resident: TownResident;
  at: number;
}) {
  const current = resident.actions.find(
    (action) => action.startAt <= at && at < action.startAt + action.durationMs,
  );
  return (
    <dl className="town-details">
      <div>
        <dt>나이대</dt>
        <dd>{ageLabels[resident.age]}</dd>
      </div>
      <div>
        <dt>직업</dt>
        <dd>{resident.job}</dd>
      </div>
      <div>
        <dt>지금 하는 일</dt>
        <dd>
          {current ? activityLabels[current.kind] : "다음 일정을 기다리는 중"}
        </dd>
      </div>
    </dl>
  );
}

export function TownPanel({
  frame,
  selection,
  select,
  close,
}: {
  frame: TownFrame;
  selection: TownSelection;
  select: (selection: TownSelection) => void;
  close: () => void;
}) {
  const shop =
    selection.kind === "shop"
      ? frame.shops.find(({ slotId }) => slotId === selection.id)
      : undefined;
  const resident =
    selection.kind === "resident"
      ? frame.residents.find(({ id }) => id === selection.id)
      : undefined;
  const title = shop?.name ?? resident?.name ?? "동네 신문";
  // Each card opens from its top, not where the previous one was scrolled to.
  const panel = useRef<HTMLElement>(null);
  const selected = `${selection.kind}:${"id" in selection ? selection.id : ""}`;
  useLayoutEffect(() => {
    if (selected && panel.current) panel.current.scrollTop = 0;
  }, [selected]);
  return (
    <aside
      ref={panel}
      id="town-panel"
      className="org-panel town-panel"
      aria-label={title}
    >
      <header className="town-panel-header">
        <h2>{title}</h2>
        <button className="campus-button" type="button" onClick={close}>
          닫기
        </button>
      </header>
      <div className="town-panel-content">
        {shop && <ShopDetails shop={shop} />}
        {resident && <ResidentDetails resident={resident} at={frame.at} />}
        {!shop && !resident && (
          <>
            <time dateTime={frame.date}>{frame.date}</time>
            <ul className="town-stories">
              {frame.news.map((story) => (
                <li key={story.id}>
                  <span>{storyLabels[story.kind]}</span>
                  <h3>{story.title}</h3>
                  <p>{story.body}</p>
                </li>
              ))}
            </ul>
            <h3>가게</h3>
            <div className="town-links">
              {frame.shops.map((entry) => (
                <button
                  type="button"
                  key={entry.slotId}
                  onClick={() => select({ kind: "shop", id: entry.slotId })}
                >
                  {entry.name}
                </button>
              ))}
            </div>
            <h3>주민 {frame.residents.length}명</h3>
            <div className="town-links">
              {frame.residents.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  onClick={() => select({ kind: "resident", id: entry.id })}
                >
                  {entry.name}
                </button>
              ))}
            </div>
          </>
        )}
        {(shop || resident) && (
          <button
            className="campus-button"
            type="button"
            onClick={() => select({ kind: "news" })}
          >
            동네 신문으로
          </button>
        )}
      </div>
    </aside>
  );
}
