import type { CharacterRelation, ScriptCharacter } from "../types";

export type CharacterRelationshipNodeData = {
    id: string;
    position: { x: number; y: number };
    label: string;
};

export type CharacterRelationshipEdgeData = {
    id: string;
    source: string;
    target: string;
    label: string;
    directed: boolean;
};

/** 将人物与关系转换为关系图所需的稳定节点和连线数据。 */
export function buildCharacterRelationshipData(characters: ScriptCharacter[], relations: CharacterRelation[]) {
    return {
        nodes: characters.map((character) => ({
            id: character.id,
            position: { x: character.graphPositionX, y: character.graphPositionY },
            label: `${character.name}${character.roleType ? ` · ${character.roleType}` : ""}`,
        })),
        edges: relations.map((relation) => ({
            id: relation.id,
            source: relation.sourceCharacterId,
            target: relation.targetCharacterId,
            label: [relation.relationshipType, relation.storyStage, relation.conflictDescription].filter(Boolean).join(" · "),
            directed: relation.relationshipDirection === "directed",
        })),
    } satisfies { nodes: CharacterRelationshipNodeData[]; edges: CharacterRelationshipEdgeData[] };
}
