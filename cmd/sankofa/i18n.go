package main

import (
	"github.com/sankofa-media/sankofa/pkg/atlas"
	"github.com/sankofa-media/sankofa/pkg/card"
)

// tr translates the few interface words the CLI prints around cards.
func tr(s string) string {
	if lang != "ru" {
		return s
	}
	if t, ok := ru[s]; ok {
		return t
	}
	return s
}

var ru = map[string]string{
	"Further":  "Дальше",
	"Further:": "Дальше:",

	// The line on a card of a pair.
	"In the other copy this theme is told through ": "В другом экземпляре эту тему рассказывает ",
	"In your copy this theme is told through ":      "В вашем экземпляре эту тему рассказывает ",

	"Sources":                                "Источники",
	"Carries":                                "Передано",
	"rhythm":                                 "ритм",
	"harmony-form":                           "гармония и форма",
	"melody-vocal":                           "мелодия и манера пения",
	"sound":                                  "звук и инструменты",
	"performance":                            "исполнение",
	"image":                                  "образ и позиция",
	"Documented":                             "Задокументировано",
	"Not documented":                         "Не задокументировано",
	"In their own words":                     "Своими словами",
	"What they listened to":                  "Что слушали",
	"What critics heard":                     "Что услышали критики",
	"In the music":                           "В самой музыке",
	"Example":                                "Пример",
	"Period":                                 "Период",
	"style":                                  "стиль",
	"Period notes":                           "Заметки о периодах",
	"The other direction (not a route step)": "В обратную сторону (не шаг маршрута)",
	"Sources:":                               "Источники:",
	"Disputed: ":                             "Спорно: ",
	"Atlas:":                                 "Атлас:",
	"Atlas: ":                                "Атлас: ",
	"← referenced by: ":                      "← ссылаются: ",
	"Right.":                                 "Верно.",
	"Not quite.":                             "Не совсем.",
	"The answer is:":                         "Ответ:",
	"There is no right answer. Here is what happened:": "Правильного ответа нет. Вот что было на самом деле:",
	"Read on: sankofa dict %s\n":                       "Читать дальше: sankofa dict %s\n",
	"Your choice (1-%d, q to quit): ":                  "Твой выбор (1–%d, q — выйти): ",
	"tab link · enter open · backspace back · / index · r random · e copy · o atlas · q quit   [%s copy · %d read]": "tab ссылка · enter открыть · backspace назад · / оглавление · r случайная · e экземпляр · o атлас · q выход   [%s экземпляр · прочитано %d]",
	"no such artist in the collection":                            "такого исполнителя в коллекции нет",
	"No cluster reachable; reading the cards built into sankofa.": "Кластер недоступен — читаю карточки, встроенные в sankofa.",
	"Index":    "Оглавление",
	"%d cards": "карточек: %d",
	"type to search · ↑↓ choose · enter open · esc back":                                         "печатай для поиска · ↑↓ выбор · enter открыть · esc назад",
	"tab link · enter open · backspace back · r random · o atlas · q quit   [%s copy · %d read]": "tab ссылка · enter открыть · backspace назад · r случайная · o атлас · q выход   [%s экземпляр · прочитано %d]",
	"person":           "человек",
	"genre":            "жанр",
	"place":            "место",
	"object":           "предмет",
	"language":         "язык",
	"script":           "письменность",
	"instrument":       "инструмент",
	"event":            "событие",
	"media":            "медиа",
	"work":             "произведение",
	"myth":             "миф",
	"comparison":       "сравнение",
	"Your copy":        "Твой экземпляр",
	"Your copy is now": "Теперь твой экземпляр",
	"male":             "мужской",
	"female":           "женский",
}

// cardPoint is the atlas point of a card in the reader's language.
func cardPoint(c *card.Card) atlas.Point {
	p := atlas.ForCard(c)
	p.Lang = lang
	return p
}
