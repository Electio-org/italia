export const DEFAULT_NEXT_ACTIONS = [
  'Prova "Confronta" se hai due anni attivi e vuoi vedere dove cambia davvero il voto.',
  'Con "Traiettoria" il comune selezionato diventa il centro della lettura storica.',
  'Usa "Diagnostica" per controllare mismatch dati↔geometrie e limiti di comparabilità.'
];

export const DEFAULT_COLLAPSED_PANELS = {
  comparison: false,
  table: false,
  rankings: true,
  multi_compare: false,
  province: true,
  heatmap: false,
  similarity: false,
  province_trends: true,
  patterns: true,
  group_compare: true,
  transitions: true,
  audit: true,
  map: false,
  detail: false
};

export function createAnalysisModes(state) {
  return {
    explore: {
      label: 'Esplora',
      description: 'Vista generale neutra: affluenza e copertura, senza suggerire una narrativa di partito finché non la scegli tu.',
      apply() {
        state.selectedMetric = 'turnout';
        state.selectedPartyMode = 'party_raw';
        state.selectedPalette = 'sequential';
        state.sameScaleAcrossYears = true;
        state.focusMode = false;
      }
    },
    compare: {
      label: 'Confronta',
      description: 'Spinge il confronto tra due elezioni: swing e doppia mappa.',
      apply() {
        state.selectedMetric = 'swing_compare';
        state.selectedPalette = 'diverging';
        state.sameScaleAcrossYears = true;
      }
    },
    trajectory: {
      label: 'Traiettoria',
      description: 'Mette al centro la storia di un comune e la quota attiva nel tempo.',
      apply() {
        state.selectedMetric = 'party_share';
        state.selectedPalette = 'sequential';
        state.trajectoryMode = 'selected_vs_context';
        if (state.selectedPartyMode === 'bloc') state.selectedPartyMode = 'party_raw';
      }
    },
    diagnose: {
      label: 'Diagnostica',
      description: 'Fa emergere qualità dati, mismatch territoriali e readiness.',
      apply() {
        state.selectedMetric = 'stability_index';
        state.selectedPalette = 'accessible';
        state.showNotes = true;
        state.focusMode = false;
      }
    },
    layers: {
      label: 'Layer esterni',
      description: 'Porta in primo piano indicatori custom e overlay esterni.',
      apply() {
        state.selectedMetric = state.customIndicators.length ? 'custom_indicator' : 'party_share';
        state.selectedPalette = 'accessible';
      }
    }
  };
}
