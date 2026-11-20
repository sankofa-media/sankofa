package angel

import (
	"context"
	"regexp"
	"time"
)

// Rules is the filter the service uses when no model is configured: the
// guard has already refused contacts, links and payment addresses; Rules
// holds back words with signs that the writer is in danger and publishes
// the rest as written. The owner's queue and the readers' reports stay the
// second line, as with the model.
type Rules struct{}

// crisisWords are plain signs of danger in the two languages of the museum.
var crisisWords = regexp.MustCompile(`(?i)(суицид|самоубий|покончить с собой|покончу с собой|не хочу жить|не хочется жить|хочу умереть|убить себя|убью себя|режу себя|порезать вены|вскрыть вены|выйти в окно|прыгнуть с крыши|suicid|kill myself|end my life|want to die|wanna die|don'?t want to live|self[- ]harm|cut myself|hurt myself)`)

// Moderate implements Moderator.
func (Rules) Moderate(_ context.Context, text, langHint string) (Judgement, error) {
	if crisisWords.MatchString(text) {
		return Judgement{Verdict: VerdictCrisis, Reason: "rules: signs of danger"}, nil
	}
	return Judgement{Verdict: VerdictPublish, CleanText: text, Lang: langHint, Reason: "rules: published as written"}, nil
}

// seedWords are the first words of the chorus, so that the first reader
// does not find it empty.
var seedWords = []Word{
	{Text: "Я так и не сказал тебе спасибо за ту зиму. Говорю сейчас.", Lang: "ru", TrEN: "I never thanked you for that winter. I am saying it now.", Theme: "gratitude"},
	{Text: "Мама, я научилась печь твой пирог. Получается почти как у тебя.", Lang: "ru", TrEN: "Mum, I learned to bake your pie. It comes out almost like yours.", Theme: "loss"},
	{Text: "I still have your number. I don't call it. I just keep it.", Lang: "en", TrRU: "Твой номер у меня до сих пор есть. Я не звоню. Просто храню.", Theme: "separation"},
	{Text: "Прости, что уехал не попрощавшись. Я думал, будет ещё время.", Lang: "ru", TrEN: "Forgive me for leaving without a goodbye. I thought there would be more time.", Theme: "forgiveness"},
	{Text: "You were right about the house by the sea. I went there last summer.", Lang: "en", TrRU: "Ты был прав насчёт дома у моря. Я съездил туда прошлым летом.", Theme: "loss"},
	{Text: "Мне до сих пор снится, что мы опять на той крыше и нам по двадцать.", Lang: "ru", TrEN: "I still dream that we are on that roof again and we are twenty.", Theme: "love"},
	{Text: "I loved you the whole time. There was just never a right evening to say it.", Lang: "en", TrRU: "Я любил тебя всё это время. Просто так и не нашлось подходящего вечера, чтобы сказать.", Theme: "love"},
}

// Seed puts the first words into an empty chorus, published; it does nothing
// once any word has been left.
func (s *Store) Seed(ctx context.Context, now time.Time) error {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM words`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	for _, w := range seedWords {
		w.TrEN, w.TrRU = orSame(w.TrEN, w.Text, w.Lang == "en"), orSame(w.TrRU, w.Text, w.Lang == "ru")
		id, err := s.Insert(ctx, w, NewDeleteCode(), now)
		if err != nil {
			return err
		}
		w.ID, w.Status, w.Reason = id, StatusPublished, "seed"
		if err := s.Update(ctx, w); err != nil {
			return err
		}
	}
	return nil
}

func orSame(tr, text string, same bool) string {
	if same {
		return text
	}
	return tr
}
