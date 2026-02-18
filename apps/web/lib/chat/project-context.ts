import {
  extractConstraintsFromUserMessage,
  normalizeHardConstraints,
} from "@/lib/filters/extract-constraints";
import type { ProjectContext, SessionData } from "@/lib/chat/types";
import type { HardConstraints } from "@/lib/types/recommendation";

type UpdateProjectContextInput = {
  message: string;
  constraints?: HardConstraints;
  projectContextOverride?: Partial<ProjectContext>;
};

const ROOM_PATTERNS = [
  "living room",
  "family room",
  "dining room",
  "bedroom",
  "office",
  "entryway",
  "hallway",
  "kitchen",
];

function normalizeRoomId(roomName: string): string {
  return roomName.trim().toLowerCase().replace(/\s+/g, "_");
}

function findRoomName(message: string): string | null {
  const lower = message.toLowerCase();
  const found = ROOM_PATTERNS.find((pattern) => lower.includes(pattern));
  return found ?? null;
}

// PSEUDOCODE
// Maintain project/room context to support multi-rug workflows over many turns.
export function updateProjectContextForTurn(
  session: SessionData,
  input: UpdateProjectContextInput
): SessionData {
  const explicit = normalizeHardConstraints(input.constraints);
  const inferred = extractConstraintsFromUserMessage(input.message);
  const mergedConstraints: HardConstraints = {
    budgetMax:
      typeof explicit.budgetMax === "number"
        ? explicit.budgetMax
        : inferred.budgetMax,
    size: explicit.size ?? inferred.size,
  };

  const roomNameFromMessage = findRoomName(input.message);
  const existing = session.project_context;
  const next: ProjectContext = {
    ...existing,
    ...input.projectContextOverride,
    rooms: [...existing.rooms],
    notes: [...existing.notes],
  };

  if (roomNameFromMessage) {
    const roomId = normalizeRoomId(roomNameFromMessage);
    const idx = next.rooms.findIndex((room) => room.room_id === roomId);
    if (idx === -1) {
      next.rooms.push({
        room_id: roomId,
        room_name: roomNameFromMessage,
        constraints: mergedConstraints,
        notes: [],
        selected_rug_ids: [],
      });
    } else {
      next.rooms[idx] = {
        ...next.rooms[idx],
        constraints: {
          ...next.rooms[idx].constraints,
          ...mergedConstraints,
        },
      };
    }
    next.active_room_id = roomId;
  }

  if (!roomNameFromMessage && Object.keys(mergedConstraints).length > 0 && next.active_room_id) {
    const idx = next.rooms.findIndex((room) => room.room_id === next.active_room_id);
    if (idx !== -1) {
      next.rooms[idx] = {
        ...next.rooms[idx],
        constraints: {
          ...next.rooms[idx].constraints,
          ...mergedConstraints,
        },
      };
    }
  }

  return {
    ...session,
    project_context: next,
  };
}
