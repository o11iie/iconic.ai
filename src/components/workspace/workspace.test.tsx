import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SemanticId } from '@/lib/semantic-id';
import type { Relationship, SpatialObject } from '@/types/domain/spatial';
import type { AnatomyStructureMetadata } from '@/anatomy/providers/anatomy-provider';
import { ContextPanel } from './ContextPanel';
import { RelationshipList, RelationshipTrail } from './RelationshipTrail';
import { AIStudyPanel } from './AIStudyPanel';
import { SpatialToolbar } from './SpatialToolbar';
import { LayersPanel } from './LayersPanel';

const lv = 'veo.anatomy.heart.left_ventricle' as SemanticId;
const rv = 'veo.anatomy.heart.right_ventricle' as SemanticId;

function objectFixture(overrides: Partial<SpatialObject> = {}): SpatialObject {
  return {
    id: lv,
    modelId: 'model-1',
    semanticId: lv,
    name: 'Left ventricle',
    kind: 'structure',
    parentId: 'veo.anatomy.heart' as SemanticId,
    childIds: [],
    system: null,
    region: null,
    layerIds: [],
    providerMeshNames: ['Heart_LV_001'],
    boundingBox: null,
    description: null,
    synonyms: [],
    metadata: {},
    ...overrides,
  };
}

describe('ContextPanel', () => {
  it('shows an honest empty state when nothing is selected', () => {
    render(
      <ContextPanel
        selectedId={null}
        object={null}
        metadata={null}
        relationships={[]}
        onSelectRelated={() => {}}
        onAction={() => {}}
        actionsEnabled={false}
      />,
    );

    expect(screen.getByText('Nothing selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /AI Explain/ })).toBeNull();
  });

  it('renders only fields the provider actually supplies', () => {
    render(
      <ContextPanel
        selectedId={lv}
        object={objectFixture()}
        metadata={null}
        relationships={[]}
        onSelectRelated={() => {}}
        onAction={() => {}}
        actionsEnabled
      />,
    );

    // Name and semantic id come from real data.
    expect(screen.getByRole('heading', { name: 'Left ventricle' })).toBeInTheDocument();
    expect(screen.getByText(lv)).toBeInTheDocument();

    // No description was supplied, so no description section is invented.
    expect(screen.queryByText('Description')).toBeNull();
    expect(
      screen.getByText('No relationships are defined for this structure.'),
    ).toBeInTheDocument();
  });

  it('renders supplied clinical metadata when present', () => {
    const metadata: AnatomyStructureMetadata = {
      semanticId: lv,
      name: 'Left ventricle',
      latinName: 'Ventriculus sinister',
      system: 'cardiovascular',
      region: 'thorax',
      laterality: 'left',
      description: 'Pumps oxygenated blood into the aorta.',
      synonyms: ['LV'],
      clinicalNotes: ['Hypertrophies in chronic hypertension.'],
      externalIds: { FMA: '7101' },
    };

    render(
      <ContextPanel
        selectedId={lv}
        object={objectFixture()}
        metadata={metadata}
        relationships={[]}
        onSelectRelated={() => {}}
        onAction={() => {}}
        actionsEnabled
      />,
    );

    expect(screen.getByText('Ventriculus sinister')).toBeInTheDocument();
    expect(screen.getByText('Pumps oxygenated blood into the aorta.')).toBeInTheDocument();
    expect(screen.getByText('Hypertrophies in chronic hypertension.')).toBeInTheDocument();
    expect(screen.getByText('7101')).toBeInTheDocument();
  });

  it('exposes every study action and reports the chosen one', async () => {
    const onAction = vi.fn();
    render(
      <ContextPanel
        selectedId={lv}
        object={objectFixture()}
        metadata={null}
        relationships={[]}
        onSelectRelated={() => {}}
        onAction={onAction}
        actionsEnabled
      />,
    );

    for (const label of ['AI Explain', 'Quiz Me', 'Flashcard', 'Add Note', 'Review Later']) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    }

    await userEvent.click(screen.getByRole('button', { name: 'Quiz Me' }));
    expect(onAction).toHaveBeenCalledWith('quiz');
  });

  it('disables study actions when no model is loaded', () => {
    render(
      <ContextPanel
        selectedId={lv}
        object={objectFixture()}
        metadata={null}
        relationships={[]}
        onSelectRelated={() => {}}
        onAction={() => {}}
        actionsEnabled={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'AI Explain' })).toBeDisabled();
  });
});

describe('RelationshipTrail', () => {
  it('renders an ordered path and reports navigation', async () => {
    const onSelect = vi.fn();
    render(
      <RelationshipTrail
        nodes={['veo.anatomy.hip.femoral_head' as SemanticId, 'veo.anatomy.hip.acetabulum' as SemanticId]}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole('button', { name: 'Femoral Head' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Acetabulum' }));
    expect(onSelect).toHaveBeenCalledWith('veo.anatomy.hip.acetabulum');
  });

  it('renders nothing rather than an invented chain when given no nodes', () => {
    const { container } = render(<RelationshipTrail nodes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('RelationshipList', () => {
  const relationship: Relationship = {
    id: 'r1',
    sourceId: lv,
    targetId: rv,
    kind: 'adjacent_to',
    label: null,
    bidirectional: true,
    confidence: 1,
    metadata: {},
  };

  it('groups edges by kind', () => {
    render(<RelationshipList relationships={[relationship]} />);
    expect(screen.getByText('adjacent to')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Right Ventricle/ })).toBeInTheDocument();
  });

  it('says so plainly when there are none', () => {
    render(<RelationshipList relationships={[]} />);
    expect(screen.getByText('No relationships are defined for this structure.')).toBeInTheDocument();
  });
});

describe('AIStudyPanel', () => {
  it('states honestly that no structure is in context', () => {
    render(<AIStudyPanel selectedId={null} modelName={null} aiConfigured hasModel={false} />);
    expect(screen.getByText('No structure selected')).toBeInTheDocument();
  });

  it('reports real context once a structure is selected', () => {
    render(<AIStudyPanel selectedId={lv} modelName="Heart" aiConfigured hasModel />);
    expect(screen.getByText('In context')).toBeInTheDocument();
    expect(screen.getByLabelText('Ask about Left Ventricle')).toBeInTheDocument();
  });

  it('shows a compact configuration notice instead of a dead input when AI is unavailable', () => {
    render(<AIStudyPanel selectedId={lv} modelName="Heart" aiConfigured={false} hasModel />);

    // The notice names the exact missing variable, but stays one line tall:
    // this bar sits under the viewport, and height here is taken from the model.
    expect(screen.getByText(/AI tutor is not configured/)).toBeInTheDocument();
    expect(screen.getByText('OPENAI_API_KEY')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('disables asking while no model is loaded', () => {
    render(<AIStudyPanel selectedId={null} modelName={null} aiConfigured hasModel={false} />);
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  });

  it('offers every study mode', () => {
    render(<AIStudyPanel selectedId={lv} modelName="Heart" aiConfigured hasModel />);
    for (const label of ['Explain', 'Teach me', 'Ask', 'Quiz me', 'Give me a hint']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });
});

describe('SpatialToolbar', () => {
  const baseProps = {
    mode: 'inspect' as const,
    onModeChange: () => {},
    onIsolate: () => {},
    onReset: () => {},
    onToggleLayers: () => {},
    layersOpen: false,
    canIsolate: true,
    hasSelection: true,
  };

  it('exposes every tool with an accessible name', () => {
    render(<SpatialToolbar {...baseProps} />);
    for (const label of ['Select', 'Explore', 'Layers', 'Isolate', 'Reset']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the active mode', () => {
    render(<SpatialToolbar {...baseProps} mode="orbit" />);
    expect(screen.getByRole('button', { name: 'Explore' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('disables isolate with an explanation rather than failing silently', () => {
    render(<SpatialToolbar {...baseProps} canIsolate={false} />);
    const isolate = screen.getByRole('button', { name: 'Isolate' });
    expect(isolate).toBeDisabled();
  });

  it('disables isolate until something is selected', () => {
    render(<SpatialToolbar {...baseProps} hasSelection={false} />);
    expect(screen.getByRole('button', { name: 'Isolate' })).toBeDisabled();
  });

  it('reports mode changes and actions', async () => {
    const onModeChange = vi.fn();
    const onReset = vi.fn();
    render(<SpatialToolbar {...baseProps} onModeChange={onModeChange} onReset={onReset} />);

    await userEvent.click(screen.getByRole('button', { name: 'Explore' }));
    expect(onModeChange).toHaveBeenCalledWith('orbit');

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalledOnce();
  });
});

describe('LayersPanel', () => {
  it('says the model declares none rather than listing invented systems', () => {
    render(<LayersPanel layers={[]} hiddenLayerIds={new Set()} onToggle={() => {}} />);
    expect(screen.getByText(/declares no separate layers/)).toBeInTheDocument();
  });

  it('renders declared layers as switches reflecting visibility', async () => {
    const onToggle = vi.fn();
    render(
      <LayersPanel
        layers={[
          {
            id: 'cardiovascular',
            modelId: 'm1',
            name: 'Cardiovascular',
            description: null,
            objectIds: [lv, rv],
            defaultVisible: true,
            order: 0,
            colorToken: null,
          },
        ]}
        hiddenLayerIds={new Set(['cardiovascular'])}
        onToggle={onToggle}
      />,
    );

    const toggle = screen.getByRole('switch', { name: /Cardiovascular/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('cardiovascular');
  });
});
