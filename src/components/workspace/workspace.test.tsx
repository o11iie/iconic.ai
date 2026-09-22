import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
    onManipulate: () => {},
    manipulation: {
      isolate: true,
      hide: true,
      ghost: true,
      dissect: true,
      restore: false,
    },
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

  it('offers every Gate 10 study mode as usable', () => {
    render(
      <AIStudyPanel selectedId={lv} modelName="Heart" aiConfigured hasModel onAsk={() => {}} />,
    );
    for (const label of ['Explain', 'Simplify', 'Deep dive', 'Function', 'Relationships']) {
      expect(screen.getByRole('radio', { name: label })).toBeEnabled();
    }
  });

  it('shows the later-gate modes, disabled, rather than hiding or faking them', () => {
    // A hidden control makes the product look smaller than it is; an enabled
    // one that does nothing is worse. Present and disabled, with a reason, is
    // the only honest option while question generation is unbuilt.
    render(
      <AIStudyPanel selectedId={lv} modelName="Heart" aiConfigured hasModel onAsk={() => {}} />,
    );

    for (const label of ['Quiz me', 'Flashcard']) {
      const control = screen.getByRole('radio', { name: new RegExp(label) });
      expect(control).toBeInTheDocument();
      expect(control).toBeDisabled();
      expect(control).toHaveAttribute('data-veo-study-available', 'false');
    }
  });

  it('asks the tutor when a Gate 10 mode is chosen', () => {
    const asked: string[] = [];
    render(
      <AIStudyPanel
        selectedId={lv}
        modelName="Heart"
        aiConfigured
        hasModel
        onAsk={(action) => asked.push(action)}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Function' }));
    expect(asked).toEqual(['FUNCTION']);
  });

  it('sends a typed question as a follow-up about the selected structure', () => {
    const asked: [string, string | undefined][] = [];
    render(
      <AIStudyPanel
        selectedId={lv}
        modelName="Heart"
        aiConfigured
        hasModel
        onAsk={(action, message) => asked.push([action, message])}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Why does it matter?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect(asked).toEqual([['FOLLOW_UP', 'Why does it matter?']]);
  });

  it('will not ask without a selected structure, so it cannot become a chatbot', () => {
    render(
      <AIStudyPanel selectedId={null} modelName="Heart" aiConfigured hasModel onAsk={() => {}} />,
    );
    expect(screen.getByRole('radio', { name: 'Explain' })).toBeDisabled();
  });
});

describe('SpatialToolbar', () => {
  const allCapabilities = {
    supportsSelection: true,
    supportsLabels: true,
    supportsRelationships: true,
    supportsLayers: true,
    supportsIsolation: true,
    supportsGhosting: true,
    supportsPeeling: true,
    supportsDissection: true,
    supportsExplosion: true,
    supportsReconstruction: true,
  };

  const baseState = {
    mode: 'inspect' as const,
    capabilities: allCapabilities,
    hasSelection: true,
    layersOpen: false,
    isolated: false,
    exploded: false,
    peelLevel: 0,
    peelSteps: 2,
    labelsOn: false,
  };

  const baseProps = {
    state: baseState,
    onModeChange: () => {},
    onAction: () => {},
  };

  it('exposes every supported tool with an accessible name', () => {
    render(<SpatialToolbar {...baseProps} />);
    for (const label of [
      'Select',
      'Explore',
      'Layers',
      'Isolate',
      'Dissect',
      'Explode',
      'Labels',
      'Reset',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('marks the active mode', () => {
    render(<SpatialToolbar {...baseProps} state={{ ...baseState, mode: 'orbit' }} />);
    expect(screen.getByRole('button', { name: 'Explore' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('omits a tool the loaded model cannot support', () => {
    // A control the model has no data for is absent, not present-but-dead: a
    // button that never does anything teaches a learner to distrust the rest.
    render(
      <SpatialToolbar
        {...baseProps}
        state={{
          ...baseState,
          capabilities: { ...allCapabilities, supportsExplosion: false, supportsPeeling: false },
        }}
      />,
    );

    expect(screen.queryByRole('button', { name: /Explode/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Peel/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Isolate' })).toBeInTheDocument();
  });

  it('disables a supported tool that needs a selection first', () => {
    render(
      <SpatialToolbar {...baseProps} state={{ ...baseState, hasSelection: false }} />,
    );
    expect(screen.getByRole('button', { name: 'Isolate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dissect' })).toBeDisabled();
  });

  it('reports how far a peel has progressed', () => {
    render(<SpatialToolbar {...baseProps} state={{ ...baseState, peelLevel: 1 }} />);
    expect(screen.getByRole('button', { name: 'Peel (1/2)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reports mode changes and actions', async () => {
    const onModeChange = vi.fn();
    const onAction = vi.fn();
    render(<SpatialToolbar {...baseProps} onModeChange={onModeChange} onAction={onAction} />);

    await userEvent.click(screen.getByRole('button', { name: 'Explore' }));
    expect(onModeChange).toHaveBeenCalledWith('orbit');

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onAction).toHaveBeenCalledWith('reset');
  });
});

describe('LayersPanel', () => {
  const layer = {
    id: 'cardiovascular',
    modelId: 'm1',
    name: 'Cardiovascular',
    description: null,
    objectIds: [lv, rv],
    defaultVisible: true,
    order: 0,
    opacity: 0.15,
    peelable: true,
    peelMode: 'ghost' as const,
    colorToken: null,
  };

  const handlers = { onShow: () => {}, onHide: () => {}, onGhost: () => {} };

  it('says the model declares none rather than listing invented systems', () => {
    render(
      <LayersPanel layers={[]} stateOf={() => 'visible'} peeledLayerIds={[]} {...handlers} />,
    );
    expect(screen.getByText(/declares no separate layers/)).toBeInTheDocument();
  });

  it('reports the real state of each declared layer', () => {
    render(
      <LayersPanel
        layers={[layer]}
        stateOf={() => 'hidden'}
        peeledLayerIds={[]}
        {...handlers}
      />,
    );

    expect(screen.getByRole('button', { name: 'Hide Cardiovascular' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Show Cardiovascular' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // The count is the layer's real membership, not a placeholder.
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('offers hide, ghost and show as distinct operations', async () => {
    const onHide = vi.fn();
    const onGhost = vi.fn();
    const onShow = vi.fn();
    render(
      <LayersPanel
        layers={[layer]}
        stateOf={() => 'visible'}
        peeledLayerIds={[]}
        onShow={onShow}
        onHide={onHide}
        onGhost={onGhost}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Ghost Cardiovascular' }));
    expect(onGhost).toHaveBeenCalledWith('cardiovascular');

    await userEvent.click(screen.getByRole('button', { name: 'Hide Cardiovascular' }));
    expect(onHide).toHaveBeenCalledWith('cardiovascular');

    await userEvent.click(screen.getByRole('button', { name: 'Show Cardiovascular' }));
    expect(onShow).toHaveBeenCalledWith('cardiovascular');
  });

  it('reports a layer the peel has taken away', () => {
    render(
      <LayersPanel
        layers={[layer]}
        stateOf={() => 'visible'}
        peeledLayerIds={['cardiovascular']}
        {...handlers}
      />,
    );
    expect(screen.getByText('Peeled away')).toBeInTheDocument();
  });
});
