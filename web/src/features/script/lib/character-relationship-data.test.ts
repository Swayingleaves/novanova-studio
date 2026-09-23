import assert from "node:assert/strict";
import test from "node:test";

import { buildCharacterRelationshipData } from "./character-relationship-data.ts";
import type { CharacterRelation, ScriptCharacter } from "../types.ts";

test("人物关系数据保留位置、方向、阶段和冲突说明", () => {
    const characters = [
        character("person-a", "林夏", "主角", 12, 24),
        character("person-b", "周野", "对手", 180, 90),
    ];
    const relations: CharacterRelation[] = [{
        id: "relation-a",
        sourceCharacterId: "person-a",
        targetCharacterId: "person-b",
        relationshipType: "竞争",
        relationshipDirection: "directed",
        storyStage: "第二幕",
        conflictDescription: "争夺关键证据",
        description: "",
        sortOrder: 0,
    }];

    const result = buildCharacterRelationshipData(characters, relations);

    assert.deepEqual(result.nodes.map((node) => [node.id, node.label, node.position]), [
        ["person-a", "林夏 · 主角", { x: 12, y: 24 }],
        ["person-b", "周野 · 对手", { x: 180, y: 90 }],
    ]);
    assert.deepEqual(result.edges[0], {
        id: "relation-a",
        source: "person-a",
        target: "person-b",
        label: "竞争 · 第二幕 · 争夺关键证据",
        directed: true,
    });
});

function character(id: string, name: string, roleType: string, graphPositionX: number,
                   graphPositionY: number): ScriptCharacter {
    return {
        id, name, roleType, graphPositionX, graphPositionY,
        identity: "", age: "", occupation: "", personality: "", valuesDescription: "", goal: "",
        desire: "", fear: "", motivation: "", appearanceDescription: "", habits: "", speechStyle: "",
        backgroundStory: "", characterArc: "", sortOrder: 0,
    };
}
