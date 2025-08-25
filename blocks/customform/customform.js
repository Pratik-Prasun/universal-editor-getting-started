import createField from './custom-form-field.js';

async function createForm(formHref, submitHref) {
  let mapping = formHref;
  if (!formHref.endsWith('json')) {
    const mappingresp = await fetch('/paths.json');
    const mappingData = await mappingresp.json();
    // let mapping = formHref;
    for (const [key, value] of Object.entries(mappingData.mappings)) {
      const [before, after] = value.split(':');
      if (before === formHref) {
        mapping = after;
        break;
      }
    }
  }
  const resp = await fetch(mapping);
  const json = await resp.json();

  const form = document.createElement('form');
  form.dataset.action = submitHref;

  const fields = await Promise.all(json.data.map((fd) => createField(fd, form)));
  fields.forEach((field) => {
    if (field) {
      form.append(field);
    }
  });

  // group fields into fieldsets
  const fieldsets = form.querySelectorAll('fieldset');
  fieldsets.forEach((fieldset) => {
    form.querySelectorAll(`[data-fieldset="${fieldset.name}"`).forEach((field) => {
      fieldset.append(field);
    });
  });

  return form;
}

function generatePayload(form) {
  const payload = {};

  [...form.elements].forEach((field) => {
    if (field.name && field.type !== 'submit' && !field.disabled) {
      if (field.type === 'radio') {
        if (field.checked) payload[field.name] = field.value;
      } else if (field.type === 'checkbox') {
        if (field.checked) payload[field.name] = payload[field.name] ? `${payload[field.name]},${field.value}` : field.value;
      } else {
        payload[field.name] = field.value;
      }
    }
  });
  return payload;
}

async function handleSubmit(form, thankYouPage) {
  if (form.getAttribute('data-submitting') === 'true') return;

  const submit = form.querySelector('button[type="submit"]');
  try {
    form.setAttribute('data-submitting', 'true');
    submit.disabled = true;

    // create payload
    const payload = generatePayload(form);
    const response = await fetch(form.dataset.action, {
      method: 'GET',
      // body: JSON.stringify({ data: payload }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (response.status === 200) {
      // Generate and auto-download PDF with "hell pdf"
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      doc.text('Sample PDF generated', 10, 10);
      doc.save('form-submission.pdf');

      // Redirect to thank you page or show success message
      if (thankYouPage) {
        window.location.href = thankYouPage;
      } else {
        const successMsg = form.querySelector('.form-success-message');
        if (!successMsg) {
          const newSuccessMsg = document.createElement('div');
          newSuccessMsg.className = 'form-success-message';
          newSuccessMsg.textContent = 'Form submitted successfully!';
          form.parentNode.insertBefore(newSuccessMsg, form);
          setTimeout(() => {
            if (newSuccessMsg && newSuccessMsg.parentNode) {
              newSuccessMsg.parentNode.removeChild(newSuccessMsg);
            }
          }, 10000);
        }
      }
    } else {
      const error = await response.text();
      let errorMsg = form.querySelector('.form-error-message');
      if (!errorMsg) {
        errorMsg = document.createElement('div');
        errorMsg.className = 'form-error-message';

        form.parentNode.insertBefore(errorMsg, form);
        setTimeout(() => {
          if (errorMsg && errorMsg.parentNode) {
            errorMsg.parentNode.removeChild(errorMsg);
          }
        }, 10000);
      }
      errorMsg.textContent = 'An error occurred. Please try again.';
      console.error('Form submission error:', error);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
  } finally {
    form.setAttribute('data-submitting', 'false');
    submit.disabled = false;
  }
}

export default async function decorate(block) {
  const formPath = block.children.item(0).children.item(0).children.item(0).children.item(0).title;
  const formLink = `${formPath}`;
  const submitLink = '/dummy-url.json'; // This should be replaced with the actual submit URL if available
  const thankYouPage = block?.children.item(1)?.children.item(0)?.children.item(0)?.children.item(0)?.href || null;
  if (!formLink || !submitLink) return;

  const form = await createForm(formLink, submitLink);
  block.replaceChildren(form);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const valid = form.checkValidity();
    if (valid) {
      handleSubmit(form, thankYouPage);
    } else {
      const firstInvalidEl = form.querySelector(':invalid:not(fieldset)');
      if (firstInvalidEl) {
        firstInvalidEl.focus();
        firstInvalidEl.scrollIntoView({ behavior: 'smooth' });
      }
    }
  });
}
