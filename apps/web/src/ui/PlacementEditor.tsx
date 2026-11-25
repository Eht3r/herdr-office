import {
  type Building,
  type Placement,
  type RoomKind,
  roomKindLabels,
  roomKinds,
} from "@herdr-office/core";
import { type FormEvent, useState } from "react";

/** Save where a machine sits: its building (site) and what its room is for. */
export async function savePlacement(
  id: string,
  placement: Placement,
): Promise<string | null> {
  const response = await fetch(
    `/api/buildings/${encodeURIComponent(id)}/placement`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(placement),
    },
  );
  if (response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;
  return body?.message ?? "저장하지 못했습니다.";
}

export function PlacementEditor({
  building,
  sites,
  onDone,
}: {
  building: Building;
  /** Existing building names, offered so a machine can join one. */
  sites: string[];
  onDone: () => void;
}) {
  const [site, setSite] = useState(building.site ?? building.name);
  const [roomKind, setRoomKind] = useState<RoomKind>(
    building.roomKind ?? "office",
  );
  const [roomName, setRoomName] = useState(
    building.roomName ?? roomKindLabels.office,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const listId = `sites-${building.id}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const message = await savePlacement(building.id, {
      site: site.trim(),
      roomKind,
      roomName: roomName.trim() || roomKindLabels[roomKind],
    });
    setSaving(false);
    if (message) setError(message);
    else onDone();
  };

  return (
    <form className="placement-editor" onSubmit={submit}>
      <label>
        건물 이름
        <input
          value={site}
          list={listId}
          maxLength={100}
          required
          onChange={(event) => setSite(event.target.value)}
        />
        <datalist id={listId}>
          {sites.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      <p className="placement-hint">
        다른 장비와 같은 이름이면 한 건물 안의 방으로, 다른 이름이면 별도
        지점으로 표시됩니다.
      </p>
      <label>
        공간 종류
        <select
          value={roomKind}
          onChange={(event) => {
            const kind = event.target.value as RoomKind;
            // Follow the kind unless the person already named the room.
            if (Object.values(roomKindLabels).includes(roomName))
              setRoomName(roomKindLabels[kind]);
            setRoomKind(kind);
          }}
        >
          {roomKinds.map((kind) => (
            <option key={kind} value={kind}>
              {roomKindLabels[kind]}
            </option>
          ))}
        </select>
      </label>
      <label>
        공간 이름
        <input
          value={roomName}
          maxLength={100}
          onChange={(event) => setRoomName(event.target.value)}
        />
      </label>
      {error && (
        <p className="placement-error" role="alert">
          {error}
        </p>
      )}
      <div className="placement-actions">
        <button className="placement-button" type="button" onClick={onDone}>
          취소
        </button>
        <button
          className="placement-button primary"
          type="submit"
          disabled={saving}
        >
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}
