import { getSummaryRecords, filterLlmVisibleSummaryRecords } from '../summary/summary-store.js';
import { getAtlasCorrections, getAtlasReviewRecords, getManualAtlasEntries, getAtlasLayerOrders } from './atlas-metadata.js';
import { invalidateAtlasProjection } from './atlas-projection-service.js';
import { ATLAS_LAYER_CATEGORIES, buildAtlasLayers, resolveAtlasLayerOrder, moveAtlasLayer, reanchorAtlasLayers } from './atlas-layer-order.js';
import { getExtensionState, beginOperation, endOperation } from '../core/extension-state.js';

export function getAtlasLayerSnapshot(category) {
    if (!ATLAS_LAYER_CATEGORIES.includes(category)) throw new Error('지원하지 않는 도감입니다.');
    const sources = {
        records: filterLlmVisibleSummaryRecords(getSummaryRecords()),
        reviews: getAtlasReviewRecords().filter(record => record.category === category),
        manual: getManualAtlasEntries(category), corrections: getAtlasCorrections()[category] || {},
    };
    const moves = getAtlasLayerOrders()[category] || [];
    const layers = buildAtlasLayers(category, sources);
    const context = SillyTavern.getContext();
    return { category, chat: context.chat, metadata: context.chatMetadata, sources, layers, moves, ordered: resolveAtlasLayerOrder(layers, moves),
        signature: JSON.stringify({ sources, moves }) };
}

export async function moveAtlasLayerAfter(snapshot, id, afterId) {
    return mutateLayers(snapshot, root => {
        root.atlas.layerOrders ||= {};
        root.atlas.layerOrders[snapshot.category] = moveAtlasLayer(snapshot.layers, snapshot.moves, id, afterId);
    });
}

export async function resetAtlasLayerOrder(snapshot) {
    return mutateLayers(snapshot, root => { if (root.atlas.layerOrders) delete root.atlas.layerOrders[snapshot.category]; });
}

export async function removeAtlasLayer(snapshot, id) {
    const layer = snapshot.layers.find(layer => layer.id === id);
    if (!layer || layer.kind === 'record') throw new Error('원본 레코드는 이 화면에서 삭제하지 않습니다.');
    if (layer.kind === 'manual' && snapshot.category !== 'perceptions') throw new Error('직접 추가 항목은 도감에서 수정하거나 삭제해주세요.');
    return mutateLayers(snapshot, root => {
        const category = snapshot.category;
        if (layer.kind === 'review') {
            const ids = new Set(layer.records.map(record => record.id));
            root.records = root.records.map(record => {
                if (!ids.has(record.id)) return record;
                const overrides = { ...record.atlasReviewOverrides };
                delete overrides[category];
                return { ...record, atlasReviewOverrides: overrides, updatedAt: new Date().toISOString() };
            });
        } else if (layer.kind === 'quick') {
            root.atlas.reviews = root.atlas.reviews.filter(review => review.id !== layer.records[0].id);
        } else if (layer.kind === 'correction') {
            const fields = root.atlas.corrections[category][layer.entityId].fields;
            for (const path of Object.keys(layer.fields)) delete fields[path];
        } else if (layer.kind === 'manual') {
            const entry = root.atlas.manual.perceptions.find(entry => entry.id === layer.entityId);
            entry.facts = [];
            entry.impression = null;
            entry.hasBaseline = false;
            entry.appliedThroughId = 0;
        }
        if (layer.entityId) delete root.atlas.translations?.[category]?.[layer.entityId];
    }, true);
}

export async function setAtlasLayerLocked(snapshot, id, locked) {
    const layer = snapshot.layers.find(layer => layer.id === id);
    if (!layer || layer.kind !== 'correction') throw new Error('잠금을 변경할 직접 수정이 없습니다.');
    return mutateLayers(snapshot, root => {
        for (const path of Object.keys(layer.fields)) root.atlas.corrections[snapshot.category][layer.entityId].fields[path].locked = Boolean(locked);
    });
}

export async function removeAtlasReviewMember(snapshot, recordId) {
    const layer = snapshot.layers.find(layer => layer.kind === 'review' && layer.records.some(record => record.id === recordId));
    if (!layer) throw new Error('초기화할 레코드 재검토판을 찾지 못했습니다.');
    if (layer.records.length === 1) return removeAtlasLayer(snapshot, layer.id);
    return mutateLayers(snapshot, root => {
        root.records = root.records.map(record => {
            if (record.id !== recordId) return record;
            const atlasReviewOverrides = { ...record.atlasReviewOverrides };
            delete atlasReviewOverrides[snapshot.category];
            return { ...record, atlasReviewOverrides, updatedAt: new Date().toISOString() };
        });
    }, true);
}

async function mutateLayers(snapshot, mutate, reanchor = false) {
    if (getExtensionState().operation) throw new Error('진행 중인 작업이 끝난 뒤 변경해주세요.');
    const context = SillyTavern.getContext();
    if (snapshot.chat !== context.chat || snapshot.metadata !== context.chatMetadata) throw new Error('채팅이 변경되었습니다.');
    if (snapshot.signature !== getAtlasLayerSnapshot(snapshot.category).signature) throw new Error('도감 내용이 변경되었습니다. 목록을 새로 확인해주세요.');
    const metadata = context.chatMetadata;
    const previous = metadata.sumi_chat_summarizer;
    const next = { ...previous, records: [...(previous.records || [])], atlas: structuredClone(previous.atlas) };
    mutate(next);
    if (reanchor) {
        const stored = new Map(next.records.map(record => [record.id, record]));
        const records = snapshot.sources.records.map(record => ({ ...record, atlasReviewOverrides: stored.get(record.id)?.atlasReviewOverrides }));
        const remaining = buildAtlasLayers(snapshot.category, { records,
            reviews: next.atlas.reviews, manual: next.atlas.manual[snapshot.category], corrections: next.atlas.corrections[snapshot.category] });
        next.atlas.layerOrders ||= {};
        next.atlas.layerOrders[snapshot.category] = reanchorAtlasLayers(snapshot.ordered, remaining, snapshot.moves);
    }
    const token = beginOperation('saving-atlas-layers', '도감 레이어 저장 중', { requiresEnabled: false });
    metadata.sumi_chat_summarizer = next;
    try { await context.saveMetadata(); }
    catch (error) { if (metadata.sumi_chat_summarizer === next) metadata.sumi_chat_summarizer = previous; throw error; }
    finally { endOperation(token); }
    invalidateAtlasProjection();
    window.dispatchEvent(new CustomEvent('stsm:records-changed'));
    window.dispatchEvent(new CustomEvent('stsm:atlas-changed'));
}
