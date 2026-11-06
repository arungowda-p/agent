import { useState } from "react";
import type { Artifact, Course } from "../../shared/api/types";
import { useAgentAPI, useMutation, useResource, useUploadQueue } from "../../shared/hooks/useAgentAPI";
import { IconPlus, IconSparkle, IconTarget, IconTrash } from "../../shared/ui/icons";
import {
  Button,
  cx,
  Dropzone,
  IconButton,
  InlineError,
  Input,
  Progress,
  SectionHeader,
  Select,
} from "../../shared/ui/primitives";
import { ArtifactList, UploadQueueList } from "../../shared/ui/UploadQueue";

export const COURSES_PATH = "/api/v1/study/courses";

function masteryTone(value: number): "bad" | "accent" | "ok" {
  if (value >= 0.75) return "ok";
  if (value >= 0.4) return "accent";
  return "bad";
}

export function SyllabusPanel({
  courses,
  course,
  onSelectCourse,
  onCourse,
  topicId,
  onTopic,
}: {
  courses: Course[];
  course: Course | null;
  onSelectCourse: (id: string) => void;
  onCourse: (course: Course) => void;
  topicId: string | null;
  onTopic: (id: string | null) => void;
}) {
  const { request, invalidate } = useAgentAPI();
  const [newCourse, setNewCourse] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const materialsPath = course ? `/api/v1/artifacts?app=study&scope=${course.id}` : null;
  const materials = useResource<Artifact[]>(materialsPath);
  const queue = useUploadQueue({
    app: "study",
    scope: course?.id ?? null,
    onIndexed: () => materialsPath && invalidate(materialsPath),
  });

  const createCourse = useMutation(async () => {
    const created = await request<Course>(COURSES_PATH, { method: "POST", json: { title: newCourse.trim() || "New course" } });
    invalidate(COURSES_PATH);
    onSelectCourse(created.id);
    setNewCourse("");
    return created;
  });

  const addTopic = useMutation(async () => {
    if (!course || !newTopic.trim()) return undefined;
    const updated = await request<Course>(`${COURSES_PATH}/${course.id}/topics`, { method: "POST", json: { title: newTopic.trim() } });
    onCourse(updated);
    setNewTopic("");
    return updated;
  });

  const removeTopic = useMutation(async (id: string) => {
    if (!course) return undefined;
    const updated = await request<Course>(`${COURSES_PATH}/${course.id}/topics/${id}`, { method: "DELETE" });
    onCourse(updated);
    if (topicId === id) onTopic(null);
    return updated;
  });

  const generate = useMutation(async () => {
    if (!course) return undefined;
    const updated = await request<Course>(`${COURSES_PATH}/${course.id}/syllabus/generate`, { method: "POST" });
    onCourse(updated);
    return updated;
  });

  const removeCourse = useMutation(async () => {
    if (!course) return undefined;
    await request(`${COURSES_PATH}/${course.id}`, { method: "DELETE" });
    invalidate(COURSES_PATH);
    return true;
  });

  const indexed = (materials.data ?? []).filter((m) => m.status === "indexed").length;

  return (
    <aside className="flex min-h-0 flex-col border-line bg-surface lg:border-r" aria-label="Syllabus tracker">
      <div className="space-y-2 border-b border-line p-3">
        {courses.length > 0 && course ? (
          <div className="flex items-center gap-1.5">
            <Select
              ariaLabel="Select course"
              value={course.id}
              onChange={onSelectCourse}
              options={courses.map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.title}` : c.title }))}
            />
            <IconButton
              label="Delete course"
              onClick={() => {
                if (window.confirm(`Delete “${course.title}” and all its material?`)) void removeCourse.run();
              }}
            >
              <IconTrash size={12} />
            </IconButton>
          </div>
        ) : null}
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void createCourse.run();
          }}
        >
          <Input placeholder="New course title" value={newCourse} onChange={(e) => setNewCourse(e.target.value)} className="h-7 text-xs" aria-label="New course title" />
          <Button type="submit" size="sm" icon={<IconPlus size={12} />} loading={createCourse.status === "loading"}>
            Add
          </Button>
        </form>
        {course ? (
          <div className="pt-1">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-[0.08em] text-ink-4">Course mastery</span>
              <span className="text-[18px] font-semibold tracking-tight text-ink tabular">{Math.round(course.overall_mastery * 100)}%</span>
            </div>
            <Progress value={course.overall_mastery} tone={masteryTone(course.overall_mastery)} className="mt-1.5 h-1" label="Course mastery" />
          </div>
        ) : null}
      </div>

      {course ? (
        <>
          <SectionHeader
            title="Syllabus"
            meta={<span className="text-[11px] text-ink-4 tabular">{course.topics.length}</span>}
            actions={
              <Button
                size="xs"
                variant="ghost"
                icon={<IconSparkle size={12} />}
                loading={generate.status === "loading"}
                disabled={indexed === 0}
                onClick={() => void generate.run()}
                title={indexed === 0 ? "Upload material first" : "Extract topics from your material"}
              >
                Generate
              </Button>
            }
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <InlineError message={generate.error?.message ?? addTopic.error?.message} />
            <ul>
              <li>
                <button
                  type="button"
                  onClick={() => onTopic(null)}
                  className={cx(
                    "flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left text-xs",
                    topicId === null ? "border-l-indigo-400 bg-zinc-900/70 text-ink" : "border-l-transparent text-ink-3 hover:bg-zinc-900/40",
                  )}
                >
                  <IconTarget size={12} className="text-ink-4" />
                  All topics
                </button>
              </li>
              {course.topics.map((topic, index) => (
                <li key={topic.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onTopic(topic.id)}
                    aria-current={topic.id === topicId ? "true" : undefined}
                    className={cx(
                      "block w-full border-l-2 px-3 py-2 text-left transition-colors",
                      topic.id === topicId ? "border-l-indigo-400 bg-zinc-900/70" : "border-l-transparent hover:bg-zinc-900/40",
                    )}
                  >
                    <div className="flex items-center gap-2 pr-5">
                      <span className="w-4 font-mono text-[10.5px] text-ink-4">{String(index + 1).padStart(2, "0")}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{topic.title}</span>
                      <span className="text-[11px] text-ink-3 tabular">{Math.round(topic.mastery * 100)}%</span>
                    </div>
                    <Progress value={topic.mastery} tone={masteryTone(topic.mastery)} className="ml-6 mt-1.5 w-auto" label={`${topic.title} mastery`} />
                    <p className="ml-6 mt-1 text-[10px] text-ink-4 tabular">
                      {topic.correct}/{topic.attempts} correct · {topic.cards_reviewed} cards
                    </p>
                  </button>
                  <IconButton
                    label={`Remove ${topic.title}`}
                    className="absolute right-2 top-1.5 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={() => void removeTopic.run(topic.id)}
                  >
                    <IconTrash size={11} />
                  </IconButton>
                </li>
              ))}
            </ul>
            <form
              className="flex gap-1.5 px-3 py-2"
              onSubmit={(event) => {
                event.preventDefault();
                void addTopic.run();
              }}
            >
              <Input placeholder="Add topic" value={newTopic} onChange={(e) => setNewTopic(e.target.value)} className="h-7 text-xs" aria-label="New topic" />
              <Button type="submit" size="sm" variant="ghost" icon={<IconPlus size={12} />} disabled={!newTopic.trim()}>
                Add
              </Button>
            </form>
          </div>

          <div className="max-h-[40%] min-h-0 shrink-0 overflow-y-auto border-t border-line">
            <SectionHeader title="Materials" meta={<span className="text-[11px] text-ink-4 tabular">{indexed} indexed</span>} />
            <div className="p-3">
              <Dropzone compact accept=".pdf,.pptx,.docx,.md,.txt" label="Slides, notes, readings" hint="PPTX speaker notes included" onFiles={queue.enqueue} />
            </div>
            <UploadQueueList items={queue.items} onCancel={queue.cancel} />
            <ArtifactList
              artifacts={materials.data ?? []}
              emptyLabel="No material uploaded."
              onDelete={(a) => void request(`/api/v1/artifacts/${a.id}`, { method: "DELETE" }).then(() => materialsPath && invalidate(materialsPath))}
            />
          </div>
        </>
      ) : null}
    </aside>
  );
}
