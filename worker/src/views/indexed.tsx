export function Indexed({ text }: { text: string }) {
  return (
    <>
      {text.split(/\^(\d+)/).map((part, i) =>
        i % 2 === 0 ? (
          part
        ) : (
          <>
            <span class="vh">^</span>
            <sup>{part}</sup>
          </>
        ),
      )}
    </>
  );
}
