// On the very first start, add one published example form so the service
// is not empty. Runs once: deleting the example does not bring it back.
async function seedOnce(store, forms) {
  if (store.data.meta.seeded) return;
  const form = await forms.create({
    title: 'Стажировка: Frontend-разработчик',
    description:
      'Оплачиваемая стажировка на 3 месяца, 20–40 часов в неделю, можно совмещать с учёбой. ' +
      'Заполнение займёт около 5 минут.',
    successMessage: 'Спасибо! Мы получили ваш отклик и ответим на почту в течение недели.',
    fields: [
      { type: 'short_text', label: 'Имя и фамилия', required: true },
      { type: 'email', label: 'Email', required: true, placeholder: 'name@mail.ru' },
      { type: 'phone', label: 'Телефон', help: 'Чтобы быстро договориться о собеседовании' },
      { type: 'short_text', label: 'Вуз и факультет', required: true },
      {
        type: 'dropdown',
        label: 'Курс',
        required: true,
        options: ['1 курс', '2 курс', '3 курс', '4 курс', 'Магистратура', 'Уже выпустился'],
      },
      {
        type: 'multiple_choice',
        label: 'С чем вы уже работали?',
        options: ['HTML/CSS', 'JavaScript', 'TypeScript', 'React', 'Vue', 'Git'],
      },
      {
        type: 'url',
        label: 'GitHub или портфолио',
        help: 'Учебные проекты тоже подойдут',
        placeholder: 'github.com/username',
      },
      {
        type: 'long_text',
        label: 'Почему вам интересна эта стажировка?',
        help: 'Пара предложений — этого достаточно',
      },
      { type: 'date', label: 'Когда готовы начать?' },
    ],
  });
  await forms.publish(form.id);
  store.data.meta.seeded = true;
  await store.save();
}

module.exports = { seedOnce };
