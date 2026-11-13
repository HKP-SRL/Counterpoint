// The Drafts page (`/h/{hostId}/changes/{changeId}/drafts`, design-drafts D-13).
//
// Low-fi: screen tabs, the round's three drafts side by side, each a sandboxed iframe (no scripts,
// an opaque origin) with a transparent layer over it built from the draft's element map. Hover
// outlines the smallest part under the pointer; a click (or S / C) selects it or opens a comment.
// Marks collect in a list until Next round. Lock ends low-fi.
// Hi-fi: state tabs, phone or desktop width, comments until Send, Addressed / Detached, the
// "also changed" notice, Unlock and Sign off. Drop drafts (confirmed) ends the hold.
// F opens a draft full-screen at the chosen width, with the same layer and marks; Esc closes.
//
// Draft pages are agent-written: they are only ever shown inside `<iframe sandbox="">` from the
// draft server's origin, and their part names and text render as React text.
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { queryKeys } from '../api';
import {
  type DraftsView,
  type DraftView,
  type DraftWidth,
  draftAction,
  draftKey,
  draftsQuery,
  fitScale,
  MARK_STATE_LABEL,
  type MapPart,
  type MarkView,
  markLabel,
  partAt,
  type ScreenView,
} from '../drafts';

/** The part the owner is acting on: hovered, or picked by a click. */
interface Target {
  draft: DraftView;
  part: MapPart;
}

/** What a draft frame reports up: hover, and a click on a part. */
interface FrameEvents {
  onHover: (target: Target | null) => void;
  onPick: (target: Target) => void;
}

const widthOf = (width: DraftWidth) => (width === 'phone' ? 390 : 1440);

/** Measures an element's width as it changes. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * One draft: the page in a sandboxed iframe, scaled to fit, with the element layer over it. With
 * no map (no browser), the page shows without a layer.
 */
function DraftFrame(props: {
  origin: string;
  draft: DraftView;
  width: DraftWidth;
  marks: readonly MarkView[];
  hovered: Target | null;
  events: FrameEvents;
  /** Fit to this width; 0 shows the page at its own size. */
  fit: number;
}) {
  const { draft, width } = props;
  const map = draft.maps?.[width] ?? null;
  const pageWidth = map?.width ?? widthOf(width);
  const pageHeight = map?.height ?? 900;
  const scale = props.fit > 0 ? fitScale(pageWidth, props.fit) : 1;
  const box = (part: MapPart) => ({
    left: part.x * scale,
    top: part.y * scale,
    width: part.w * scale,
    height: part.h * scale,
  });
  const at = (event: MouseEvent<HTMLDivElement>): MapPart | null => {
    if (map === null) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    return partAt(map, (event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
  };
  const hoveredHere = props.hovered?.draft.id === draft.id ? props.hovered.part : null;
  const marked = props.marks.filter((mark) => mark.draftId === draft.id);
  if (draft.url === null) return null;
  return (
    <div
      style={{
        position: 'relative',
        width: pageWidth * scale,
        height: pageHeight * scale,
        overflow: 'hidden',
        border: '1px solid var(--color-border, #ddd)',
        borderRadius: 6,
        background: '#fff',
      }}
    >
      <iframe
        title={`Draft ${draft.slot}`}
        src={`${props.origin}${draft.url}`}
        sandbox=""
        loading="lazy"
        referrerPolicy="no-referrer"
        style={{
          border: 0,
          width: pageWidth,
          height: pageHeight,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        }}
      />
      {map === null ? null : (
        <div
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
          onMouseMove={(event) => {
            const part = at(event);
            props.events.onHover(part === null ? null : { draft, part });
          }}
          onMouseLeave={() => props.events.onHover(null)}
          onClick={(event) => {
            const part = at(event);
            if (part !== null) props.events.onPick({ draft, part });
          }}
        >
          {marked.map((mark) => {
            const part = map.parts.find((p) => p.id === mark.part);
            if (part === undefined) return null;
            return (
              <div
                key={mark.id}
                style={{
                  position: 'absolute',
                  ...box(part),
                  outline: `2px ${mark.kind === 'select' ? 'solid' : 'dashed'} var(--color-live, #980fb2)`,
                  pointerEvents: 'none',
                }}
              />
            );
          })}
          {hoveredHere === null ? null : (
            <div
              style={{
                position: 'absolute',
                ...box(hoveredHere),
                outline: '2px solid var(--color-accent, #444)',
                background: 'rgba(120, 120, 120, 0.08)',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Select / Comment on the picked part. */
function PartBar(props: {
  target: Target | null;
  canSelect: boolean;
  commenting: boolean;
  onSelect: () => void;
  onComment: () => void;
  onSend: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!props.commenting) setNote('');
  }, [props.commenting]);
  if (props.target === null) {
    return (
      <Text type="supporting" color="secondary">
        Point at a part of a draft. Click it, or press S to select it, C to comment, F for
        full-screen.
      </Text>
    );
  }
  const { draft, part } = props.target;
  return (
    <HStack gap={3} vAlign="end" wrap="wrap">
      <Text type="label">{`${draft.slot} · ${part.id}`}</Text>
      {props.commenting ? (
        <TextInput
          label={`Comment on ${part.id}`}
          value={note}
          hasAutoFocus
          placeholder="What should change here?"
          onChange={(value) => setNote(value)}
          onEnter={() => {
            if (note.trim() !== '') props.onSend(note);
          }}
        />
      ) : null}
      {props.canSelect && !props.commenting ? (
        <Button label="Select" variant="secondary" onClick={props.onSelect} />
      ) : null}
      {props.commenting ? (
        <Button
          label="Add comment"
          variant="primary"
          isDisabled={note.trim() === ''}
          onClick={() => props.onSend(note)}
        />
      ) : (
        <Button label="Comment" variant="secondary" onClick={props.onComment} />
      )}
      <Button label="Close" variant="ghost" onClick={props.onClose} />
    </HStack>
  );
}

function WidthControl(props: { width: DraftWidth; onChange: (width: DraftWidth) => void }) {
  return (
    <SegmentedControl
      label="Frame width"
      value={props.width}
      onChange={(value) => props.onChange(value === 'phone' ? 'phone' : 'desktop')}
    >
      <SegmentedControlItem value="phone" label="Phone" />
      <SegmentedControlItem value="desktop" label="Desktop" />
    </SegmentedControl>
  );
}

/** A draft while it is made, or when it failed. */
function DraftPlaceholder(props: { draft: DraftView; onRetry: () => void }) {
  if (props.draft.state === 'running') {
    return (
      <VStack gap={2} aria-busy="true">
        <HStack gap={2} vAlign="center">
          <Spinner size="sm" />
          <Text type="supporting" color="secondary">
            Drawing…
          </Text>
        </HStack>
        <Skeleton width="100%" height={240} />
      </VStack>
    );
  }
  if (props.draft.state === 'failed') {
    return (
      <Banner
        status="error"
        title="This draft failed"
        description={props.draft.error ?? undefined}
        endContent={<Button label="Try again" variant="secondary" onClick={props.onRetry} />}
      />
    );
  }
  return null;
}

/** Full-screen (spec: Full-screen review): one draft at the chosen width, same layer and marks. */
function FullScreen(props: {
  origin: string;
  draft: DraftView;
  width: DraftWidth;
  onWidth: (width: DraftWidth) => void;
  marks: readonly MarkView[];
  hovered: Target | null;
  events: FrameEvents;
  bar: React.ReactNode;
  onClose: () => void;
}) {
  const [ref, available] = useWidth<HTMLDivElement>();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Draft ${props.draft.slot}, full-screen`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-background, #fff)',
      }}
    >
      <div style={{ padding: 12, borderBottom: '1px solid var(--color-border, #ddd)' }}>
        <VStack gap={2}>
          <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
            <Text type="label" weight="semibold">{`Draft ${props.draft.slot}`}</Text>
            <HStack gap={3} vAlign="center">
              <WidthControl width={props.width} onChange={props.onWidth} />
              <Button label="Close (Esc)" variant="secondary" onClick={props.onClose} />
            </HStack>
          </HStack>
          {props.bar}
        </VStack>
      </div>
      <div ref={ref} style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div style={{ margin: '0 auto', width: 'fit-content' }}>
          <DraftFrame
            origin={props.origin}
            draft={props.draft}
            width={props.width}
            marks={props.marks}
            hovered={props.hovered}
            events={props.events}
            fit={Math.max(available - 32, 0)}
          />
        </div>
      </div>
    </div>
  );
}

/** The screen's view: low-fi round or hi-fi version, with the element layer, marks and keys. */
function ScreenPanel(props: {
  hostId: string;
  change: string;
  origin: string;
  screen: ScreenView;
  hiFiUnavailable: string | null;
  act: (action: string, body?: unknown) => Promise<void>;
}) {
  const { screen, act } = props;
  const round = screen.round;
  const hifi = round?.stage === 'hifi';
  const [width, setWidth] = useState<DraftWidth>(hifi ? 'desktop' : 'phone');
  const [state, setState] = useState(screen.states[0] ?? 'main');
  const [hovered, setHovered] = useState<Target | null>(null);
  const [picked, setPicked] = useState<Target | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [full, setFull] = useState<DraftView | null>(null);
  const [rowRef, rowWidth] = useWidth<HTMLDivElement>();
  const target = picked ?? hovered;
  const marks = screen.marks;

  const close = useCallback(() => {
    if (commenting || picked !== null) {
      setCommenting(false);
      setPicked(null);
    } else setFull(null);
  }, [commenting, picked]);

  const mark = useCallback(
    async (kind: 'select' | 'comment', note: string | null) => {
      if (target === null) return;
      await act(`drafts/${target.draft.id}/marks`, { part: target.part.id, kind, note, width });
      setCommenting(false);
      setPicked(null);
    },
    [act, target, width],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const field = event.target instanceof HTMLElement ? event.target : null;
      const typing =
        field !== null &&
        (field.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(field.tagName));
      const action = draftKey(
        { key: event.key, modified: event.metaKey || event.ctrlKey || event.altKey, typing },
        {
          part: target !== null,
          canSelect: !hifi,
          draft: target !== null || full !== null,
          open: commenting || picked !== null || full !== null,
        },
      );
      if (action === null) return;
      event.preventDefault();
      if (action.type === 'select') void mark('select', null);
      else if (action.type === 'comment') {
        setPicked(target);
        setCommenting(true);
      } else if (action.type === 'fullscreen') setFull(target?.draft ?? full);
      else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, hifi, full, commenting, picked, mark, close]);

  const events: FrameEvents = {
    onHover: (next) => {
      if (picked === null) setHovered(next);
    },
    onPick: (next) => {
      setPicked(next);
      setCommenting(false);
    },
  };
  // The part bar stays in view at the bottom while the owner scrolls a tall draft.
  const bar = (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 2,
        padding: '8px 0',
        background: 'var(--color-background, #fff)',
      }}
    >
      <PartBar
        target={target}
        canSelect={!hifi}
        commenting={commenting}
        onSelect={() => void mark('select', null)}
        onComment={() => {
          setPicked(target);
          setCommenting(true);
        }}
        onSend={(note) => void mark('comment', note)}
        onClose={() => {
          setCommenting(false);
          setPicked(null);
        }}
      />
    </div>
  );

  if (round === null) {
    return (
      <Card padding={4} elevation="none">
        <VStack gap={3}>
          <Text>{screen.purpose}</Text>
          <Text type="supporting" color="secondary">{`States: ${screen.states.join(', ')}`}</Text>
          <HStack gap={2}>
            <Button
              label="Draw round 1"
              variant="primary"
              onClick={() => void act(`screens/${screen.id}/round`)}
            />
            <Button
              label="Drop this screen"
              variant="ghost"
              onClick={() => void act(`screens/${screen.id}/drop`)}
            />
          </HStack>
        </VStack>
      </Card>
    );
  }

  const fullScreen =
    full === null ? null : (
      <FullScreen
        origin={props.origin}
        draft={round.drafts.find((d) => d.id === full.id) ?? full}
        width={width}
        onWidth={setWidth}
        marks={marks}
        hovered={target}
        events={events}
        bar={bar}
        onClose={() => setFull(null)}
      />
    );

  if (!hifi) {
    const running = round.state === 'running';
    const open = marks.filter((m) => m.state === 'open');
    const column = Math.max((rowWidth - 32) / 3, 0);
    return (
      <VStack gap={4}>
        <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
          <Text type="label" weight="semibold">{`${screen.name} · round ${round.number}`}</Text>
          <WidthControl width={width} onChange={setWidth} />
        </HStack>
        {screen.stage === 'locked' ? (
          <Banner
            status={props.hiFiUnavailable === null ? 'info' : 'warning'}
            title={
              props.hiFiUnavailable === null
                ? 'Locked: making the hi-fi draft'
                : 'Locked, but hi-fi is unavailable'
            }
            description={props.hiFiUnavailable ?? undefined}
          />
        ) : null}
        <div ref={rowRef} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          {round.drafts.map((draft) => (
            <div key={draft.id} style={{ flex: '1 1 0', minWidth: 0 }}>
              <VStack gap={2}>
                <Text type="label" weight="semibold">
                  {draft.slot}
                </Text>
                {draft.direction === null ? null : (
                  <Text type="supporting" color="secondary">
                    {draft.direction}
                  </Text>
                )}
                <DraftPlaceholder
                  draft={draft}
                  onRetry={() => void act(`drafts/${draft.id}/retry`)}
                />
                {draft.state === 'ready' ? (
                  <>
                    <DraftFrame
                      origin={props.origin}
                      draft={draft}
                      width={width}
                      marks={marks}
                      hovered={target}
                      events={events}
                      fit={column}
                    />
                    <HStack gap={2}>
                      <Button
                        label={`Lock ${draft.slot}`}
                        variant="secondary"
                        isDisabled={screen.stage !== 'low' || running}
                        onClick={() => void act(`drafts/${draft.id}/lock`)}
                      />
                      <Button label="Full-screen" variant="ghost" onClick={() => setFull(draft)} />
                    </HStack>
                  </>
                ) : null}
              </VStack>
            </div>
          ))}
        </div>
        {bar}
        <Card padding={4} elevation="none" aria-label="Marks">
          <VStack gap={3}>
            <Text type="label" weight="semibold">
              Marks
            </Text>
            {open.length === 0 ? (
              <Text type="supporting" color="secondary">
                None yet. Select the parts to keep and comment on what should change; the next round
                builds three new drafts from them.
              </Text>
            ) : (
              <VStack gap={1}>
                {open.map((m) => (
                  <HStack key={m.id} gap={2} vAlign="center">
                    <Text>{markLabel(m)}</Text>
                    <Button
                      label="Remove"
                      variant="ghost"
                      size="sm"
                      onClick={() => void act(`marks/${m.id}/delete`)}
                    />
                  </HStack>
                ))}
              </VStack>
            )}
            <HStack gap={2}>
              <Button
                label="Next round"
                variant="primary"
                isDisabled={running || screen.stage !== 'low'}
                onClick={() => void act(`screens/${screen.id}/round`)}
              />
            </HStack>
          </VStack>
        </Card>
        {fullScreen}
      </VStack>
    );
  }

  // Hi-fi.
  const draft = round.drafts.find((d) => d.slot === state) ?? round.drafts[0];
  const comments = marks.filter((m) => m.kind === 'comment');
  const unsent = comments.filter((m) => m.state === 'open');
  const signed = screen.stage === 'signed';
  const busy = round.state === 'running';
  return (
    <VStack gap={4}>
      <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
        <HStack gap={3} vAlign="center">
          <Text type="label" weight="semibold">{`${screen.name} · hi-fi`}</Text>
          {signed ? <Badge variant="neutral" label="Signed off" /> : null}
        </HStack>
        <HStack gap={3} vAlign="center">
          <WidthControl width={width} onChange={setWidth} />
          {draft === undefined ? null : (
            <Button label="Full-screen" variant="ghost" onClick={() => setFull(draft)} />
          )}
        </HStack>
      </HStack>
      <TabList value={state} onChange={setState}>
        {screen.states.map((s) => (
          <Tab key={s} value={s} label={s} />
        ))}
      </TabList>
      {round.state === 'failed' ? (
        <Banner
          status="error"
          title="The hi-fi draft failed"
          description={round.error ?? undefined}
          endContent={
            <Button
              label="Try again"
              variant="secondary"
              onClick={() => void act(`screens/${screen.id}/retry`)}
            />
          }
        />
      ) : null}
      {round.alsoChanged.length > 0 ? (
        <Banner
          status="warning"
          title="Also changed"
          description={`The revision also changed parts nobody commented on: ${round.alsoChanged.join(', ')}.`}
        />
      ) : null}
      {signed && screen.signoff !== null ? (
        <Banner
          status={screen.signoff.state === 'blocked' ? 'warning' : 'info'}
          title={
            screen.signoff.state === 'merged'
              ? 'Signed off and on the base branch'
              : 'Signed off; landing as a small PR'
          }
          description={screen.signoff.reason ?? undefined}
          endContent={
            screen.signoff.prUrl === null ? undefined : (
              <Link href={screen.signoff.prUrl} target="_blank" rel="noreferrer">
                Pull request
              </Link>
            )
          }
        />
      ) : null}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div ref={rowRef} style={{ flex: '3 1 0', minWidth: 0 }}>
          {draft === undefined ? null : draft.state === 'ready' ? (
            <DraftFrame
              origin={props.origin}
              draft={draft}
              width={width}
              marks={comments.filter((m) => m.state === 'open')}
              hovered={target}
              events={events}
              fit={rowWidth}
            />
          ) : (
            <DraftPlaceholder
              draft={draft}
              onRetry={() => void act(`screens/${screen.id}/retry`)}
            />
          )}
        </div>
        <div style={{ flex: '1 1 0', minWidth: 220 }}>
          <Card padding={4} elevation="none" aria-label="Comments">
            <VStack gap={3}>
              <Text type="label" weight="semibold">
                Comments
              </Text>
              {comments.length === 0 ? (
                <Text type="supporting" color="secondary">
                  Click a part to comment on it. Comments go out together, and only those parts
                  change.
                </Text>
              ) : (
                <VStack gap={2}>
                  {comments.map((m) => (
                    <VStack key={m.id} gap={0.5}>
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <Text type="label">{`${m.slot ?? ''} · ${m.part}`}</Text>
                        <Badge
                          variant={m.state === 'detached' ? 'warning' : 'neutral'}
                          label={MARK_STATE_LABEL[m.state]}
                        />
                        {m.state === 'open' ? (
                          <Button
                            label="Remove"
                            variant="ghost"
                            size="sm"
                            onClick={() => void act(`marks/${m.id}/delete`)}
                          />
                        ) : null}
                      </HStack>
                      <Text type="supporting">{m.note ?? ''}</Text>
                    </VStack>
                  ))}
                </VStack>
              )}
              {signed ? null : (
                <VStack gap={2}>
                  <Button
                    label={
                      unsent.length === 1 ? 'Send 1 comment' : `Send ${unsent.length} comments`
                    }
                    variant="primary"
                    isDisabled={unsent.length === 0 || busy}
                    onClick={() => void act(`screens/${screen.id}/send`)}
                  />
                  <HStack gap={2}>
                    <Button
                      label="Unlock"
                      variant="secondary"
                      isDisabled={busy}
                      onClick={() => void act(`screens/${screen.id}/unlock`)}
                    />
                    <Button
                      label="Sign off"
                      variant="secondary"
                      isDisabled={busy || round.state !== 'ready' || unsent.length > 0}
                      onClick={() => void act(`screens/${screen.id}/sign-off`)}
                    />
                  </HStack>
                </VStack>
              )}
            </VStack>
          </Card>
        </div>
      </div>
      {signed ? null : bar}
      {fullScreen}
    </VStack>
  );
}

/** Before round 1 of any screen: the screen list to edit. */
function AddScreen(props: { act: (action: string, body?: unknown) => Promise<void> }) {
  const [name, setName] = useState('');
  const add = async () => {
    if (name.trim() === '') return;
    await props.act('screens', { name });
    setName('');
  };
  return (
    <HStack gap={2} vAlign="end">
      <TextInput
        label="Add a screen"
        value={name}
        placeholder="Screen name"
        onChange={setName}
        onEnter={() => void add()}
      />
      <Button
        label="Add"
        variant="secondary"
        isDisabled={name.trim() === ''}
        onClick={() => void add()}
      />
    </HStack>
  );
}

export function DraftsPage({ hostId, changeId }: { hostId: string; changeId: string }) {
  const client = useQueryClient();
  const query = useQuery(draftsQuery(hostId, changeId));
  const view: DraftsView | undefined = query.data;
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDrop, setConfirmDrop] = useState(false);

  useEffect(() => {
    document.title = `${changeId} drafts · Counterpoint`;
  }, [changeId]);

  const act = useCallback(
    async (action: string, body: unknown = {}) => {
      setError(await draftAction(hostId, changeId, action, body));
      await client.invalidateQueries({ queryKey: queryKeys.drafts(hostId, changeId) });
    },
    [client, hostId, changeId],
  );

  const screens = view?.screens ?? [];
  const screen = screens.find((s) => s.id === selected) ?? screens[0];

  const header = (
    <VStack gap={2}>
      <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
        <HStack gap={3} vAlign="center" wrap="wrap">
          <Link href={`/h/${hostId}/changes/${changeId}`}>{changeId}</Link>
          <Text color="secondary">›</Text>
          <Heading level={2} accessibilityLevel={1}>
            Drafts
          </Heading>
          {view?.hold.held === true ? (
            <Badge variant="warning" label="Waiting for sign-off" />
          ) : null}
        </HStack>
        {view?.started === true ? (
          <Button label="Drop drafts" variant="ghost" onClick={() => setConfirmDrop(true)} />
        ) : null}
      </HStack>
      {error === null ? null : <Banner status="error" title={error} />}
    </VStack>
  );

  let body: React.ReactNode;
  if (view === undefined) {
    body = query.isError ? (
      <Banner status="error" title="Couldn't load the drafts" />
    ) : (
      <Skeleton width="100%" height={320} />
    );
  } else if (!view.started) {
    body = (
      <EmptyState
        headingLevel={2}
        title="No drafts yet"
        description="Counterpoint lists the screens this change needs, then draws three low-fi drafts of each. Until every screen is signed off, the change does not build."
        actions={
          <Button label="Start drafts" variant="primary" onClick={() => void act('start')} />
        }
      />
    );
  } else if (view.list?.state === 'listing') {
    body = (
      <HStack gap={2} vAlign="center">
        <Spinner size="sm" />
        <Text>Listing the screens this change needs…</Text>
      </HStack>
    );
  } else if (view.list?.state === 'failed' && screens.length === 0) {
    body = (
      <Banner
        status="error"
        title="The screen list failed"
        description={view.list.error ?? undefined}
        endContent={
          <Button label="Try again" variant="secondary" onClick={() => void act('retry-list')} />
        }
      />
    );
  } else if (view.origin === null) {
    body = (
      <Banner
        status="error"
        title="The draft server is not running"
        description="Restart Counterpoint to show drafts."
      />
    );
  } else {
    body = (
      <VStack gap={4}>
        <HStack gap={3} vAlign="end" justify="between" wrap="wrap">
          {screens.length === 0 ? (
            <Text color="secondary">This change has no screens. Add one, or drop the drafts.</Text>
          ) : (
            <TabList
              value={String(screen?.id ?? '')}
              onChange={(value) => setSelected(Number(value))}
            >
              {screens.map((s) => (
                <Tab
                  key={s.id}
                  value={String(s.id)}
                  label={s.stage === 'signed' ? `${s.name} ✓` : s.name}
                />
              ))}
            </TabList>
          )}
          <AddScreen act={act} />
        </HStack>
        {screen === undefined ? null : (
          <ScreenPanel
            key={`${screen.id}:${screen.round?.stage ?? 'none'}`}
            hostId={hostId}
            change={changeId}
            origin={view.origin}
            screen={screen}
            hiFiUnavailable={view.hiFiUnavailable}
            act={act}
          />
        )}
      </VStack>
    );
  }

  return (
    <>
      <Layout
        header={<LayoutHeader>{header}</LayoutHeader>}
        content={<LayoutContent>{body}</LayoutContent>}
      />
      <AlertDialog
        isOpen={confirmDrop}
        onOpenChange={setConfirmDrop}
        title={`Drop the drafts of ${changeId}?`}
        description="Every screen, round and comment is deleted, and the change builds without drafts. Pages already signed off stay in git."
        actionLabel="Drop drafts"
        actionVariant="destructive"
        onAction={() => {
          setConfirmDrop(false);
          void act('drop');
        }}
      />
    </>
  );
}
