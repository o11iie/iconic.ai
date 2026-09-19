import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SemanticId } from '@/lib/semantic-id';
import type { Relationship, SpatialObject } from '@/types/domain/spatial';
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
  const base = {
    trail: [] as never[],
    childObjects: [] as never[],
    relationships: [] as never[],
    onSelectObject: () => {},
    onAction: () => {},
  };

  it('invites selection when nothing is selected', () => {
    render(<ContextPanel {...base} selectedId={null} object={null} actionsEnabled={false} />);

    expect(screen.getByText('Select a structure to explore')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /AI Explain/ })).toBeNull();
  });

  it('renders only fields the model actually supplies', () => {
    render(
      <ContextPanel {...base} selectedId={lv} object={objectFixture()} actionsEnabled />,
    );

    // Name and semantic id come from the resolved SpatialObject, never a mesh.
    expect(screen.getByRole('heading', { name: 'Left ventricle' })).toBeInTheDocument();
    expect(screen.getByText(lv)).toBeInTheDocument();

    // No description was supplied, so no description section is invented.
    expect(screen.queryByText('Description')).toBeNull();
    expect(screen.getByText('No relationships are defined for this structure.')).toBeInTheDocument();
  });

  it('renders descriptor content when the model supplies it', () => {
    render(
      <ContextPanel
        {...base}
        selectedId={lv}
        object={objectFixture({
          system: 'cardiovascular',
          region: 'thorax',
          description: 'Pumps oxygenated blood into the aorta.',
          synonyms: ['LV'],
          metadata: {
            latinName: 'Ventriculus sinister',
            clinicalNotes: ['Hypertrophies in chronic hypertension.'],
            externalIds: { FMA: '7101' },
          },
        })}
        actionsEnabled
      />,
    );

    expect(screen.getByText('Ventriculus sinister')).toBeInTheDocument();
    expect(screen.getByText('Pumps oxygenated blood into the aorta.')).toBeInTheDocument();
    expect(screen.getByText('Hypertrophies in chronic hypertension.')).toBeInTheDocument();
    expect(screen.getByText('7101')).toBeInTheDocument();
    expect(screen.getByText('cardiovascular')).toBeInTheDocument();
  });

  it('renders hierarchy and lets the learner navigate it', async () => {
    const onSelectObject = vi.fn();
    render(
      <ContextPanel
        {...base}
        selectedId={lv}
        object={objectFixture()}
        trail={[
          { semanticId: 'veo.anatomy.heart' as SemanticId, name: 'Heart' },
          { semanticId: lv, name: 'Left ventricle' },
        ]}
        childObjects={[{ semanticId: rv, name: 'Right ventricle' }]}
        onSelectObject={onSelectObject}
        actionsEnabled
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Structure hierarchy' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Heart' }));
    expect(onSelectObject).toHaveBeenCalledWith('veo.anatomy.heart');

    await userEvent.click(screen.getByRole('button', { name: /Right ventricle/ }));
    expect(onSelectObject).toHaveBeenCalledWith(rv);
  });

  it('passes complete semantic context to every action handler', async () => {
    // The actions are not implemented yet, but they must already receive the
    // full context so wiring them later is a handler change, not a redesign.
    const onAction = vi.fn();
    render(
      <ContextPanel
        {...base}
        selectedId={lv}
        object={objectFixture()}
        trail={[
          { semanticId: 'veo.anatomy.heart' as SemanticId, name: 'Heart' },
          { semanticId: lv, name: 'Left ventricle' },
        ]}
        onAction={onAction}
        actionsEnabled
      />,
    );

    for (const label of ['AI Explain', 'Quiz Me', 'Flashcard', 'Add Note', 'Review Later']) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    }

    await userEvent.click(screen.getByRole('button', { name: 'Quiz Me' }));

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quiz',
        semanticId: lv,
        object: expect.objectContaining({ name: 'Left ventricle' }),
        ancestors: ['veo.anatomy.heart'],
      }),
    );
  });

  it('disables study actions when no model is loaded', () => {
    render(
      <ContextPanel {...base} selectedId={lv} object={objectFixture()} actionsEnabled={false} />,
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
