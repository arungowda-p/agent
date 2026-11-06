import { useCallback, useEffect } from "react";
import type { Course } from "../../shared/api/types";
import { usePersistentState, useResource } from "../../shared/hooks/useAgentAPI";
import { IconBook } from "../../shared/ui/icons";
import { EmptyState, Spinner } from "../../shared/ui/primitives";
import { Flashcards } from "./Flashcards";
import { QuizPanel } from "./QuizPanel";
import { COURSES_PATH, SyllabusPanel } from "./SyllabusPanel";
import { TutorChat } from "./TutorChat";

export default function StudyCopilot() {
  const courses = useResource<Course[]>(COURSES_PATH);
  const [courseId, setCourseId] = usePersistentState<string | null>("study:course", null);
  const [topicId, setTopicId] = usePersistentState<string | null>("study:topic", null);

  const list = courses.data ?? [];
  const course = list.find((c) => c.id === courseId) ?? list[0] ?? null;
  const topic = course?.topics.find((t) => t.id === topicId) ?? null;

  useEffect(() => {
    if (course && topicId && !course.topics.some((t) => t.id === topicId)) setTopicId(null);
  }, [course, topicId, setTopicId]);

  const replaceCourse = useCallback(
    (updated: Course) => courses.mutate((prev) => (prev ?? []).map((c) => (c.id === updated.id ? updated : c))),
    [courses],
  );

  if (courses.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-ink-4">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_360px]">
      <SyllabusPanel
        courses={list}
        course={course}
        onSelectCourse={(id) => {
          setCourseId(id);
          setTopicId(null);
        }}
        onCourse={replaceCourse}
        topicId={topic?.id ?? null}
        onTopic={setTopicId}
      />
      {course ? (
        <>
          <TutorChat key={course.id} course={course} topic={topic} />
          <aside className="flex min-h-0 flex-col overflow-y-auto border-t border-line bg-surface lg:col-span-2 xl:col-span-1 xl:border-l xl:border-t-0" aria-label="Practice">
            <Flashcards course={course} topic={topic} onCourse={replaceCourse} />
            <QuizPanel course={course} topic={topic} onCourse={replaceCourse} />
          </aside>
        </>
      ) : (
        <div className="xl:col-span-2">
          <EmptyState
            icon={<IconBook size={22} />}
            title="Create a course to begin"
            body="Add a course, upload lecture slides or notes, then chat with a tutor, drill flashcards and take quizzes that track your mastery."
          />
        </div>
      )}
    </div>
  );
}
