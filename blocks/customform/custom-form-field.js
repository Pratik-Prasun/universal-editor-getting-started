import { toClassName } from '../../scripts/aem.js';

function createFieldWrapper(fd) {
  const fieldWrapper = document.createElement('div');
  fieldWrapper.classList.add('field-wrapper', `${fd.Type}-wrapper`, `${fd.Style || 'col1'}-column-wrapper`);

  fd.Fieldset ? fieldWrapper.dataset.fieldset = fd.Fieldset : null;

  return fieldWrapper;
}

const ids = [];

function generateFieldId(fd, suffix = '') {
  const slug = toClassName(`form-${fd.Name}${suffix}`);
  ids[slug] = ids[slug] || 0;
  const idSuffix = ids[slug] ? `-${ids[slug]}` : '';
  ids[slug] += 1;
  return `${slug}${idSuffix}`;
}

function createLabel(fd) {
  const label = document.createElement('label');
  label.id = generateFieldId(fd, '-label');
  label.textContent = fd.Label || fd.Name;
  label.setAttribute('for', fd.Id);
  if (fd.Mandatory.toLowerCase() === 'true' || fd.Mandatory.toLowerCase() === 'x') {
    label.dataset.required = true;
    label.textContent += '*';
  }
  return label;
}

function setCommonAttributes(field, fd) {
  field.id = fd.Id;
  field.name = fd.Name;
  field.required = fd.Mandatory && (fd.Mandatory.toLowerCase() === 'true' || fd.Mandatory.toLowerCase() === 'x');
  field.placeholder = fd.Placeholder;
  field.value = fd.Value;
  field.maxLength = fd.Maxlength;
  field.autocomplete = fd.Autocomplete || 'off';
}

const createHeading = (fd) => {
  const fieldWrapper = createFieldWrapper(fd);

  const level = fd.Style && fd.Style.includes('sub-heading') ? 3 : 2;
  const heading = document.createElement(`h${level}`);
  heading.textContent = fd.Value || fd.Label;
  heading.id = fd.Id;

  fieldWrapper.append(heading);

  return { field: heading, fieldWrapper };
};

const createPlaintext = (fd) => {
  const fieldWrapper = createFieldWrapper(fd);

  const text = document.createElement('p');
  text.textContent = fd.Value || fd.Label;
  text.id = fd.Id;

  fieldWrapper.append(text);

  return { field: text, fieldWrapper };
};

const createSelect = async (fd) => {
  const select = document.createElement('select');
  setCommonAttributes(select, fd);
  const addOption = ({ text, value }) => {
    const option = document.createElement('option');
    if (text === undefined) {
      option.text = 'none';
      option.value = 'none';
    } else {
      option.text = text.trim();
      option.value = value.trim();
    }

    select.addEventListener('change', () => {
      Array.from(select.options).forEach((option) => {
        if (option.value === select.value) {
          option.setAttribute('selected', '');
        } else {
          option.removeAttribute('selected');
        }
      });
    });

    select.add(option);
    return option;
  };

  if (fd.Placeholder) {
    const ph = addOption({ text: fd.Placeholder, value: '' });
    ph.setAttribute('disabled', '');
  }

  async function setValues(resp, options) {
    const json = await resp.json();
    json.data.forEach((opt) => {
      options.push({
        text: opt.Option,
        value: opt.Value || opt.Option,
      });
    });
  }

  if (fd.Options) {
    let options = [];
    if (fd.Options.startsWith('https://')) {
      const optionsUrl = new URL(fd.Options);
      const resp = await fetch(`${optionsUrl.pathname}${optionsUrl.search}`);
      await setValues(resp, options);
    } else if (fd.Options.startsWith('/')) {
      const resp = await fetch(`${fd.Options}`);
      await setValues(resp, options);
    } else {
      options = fd.Options.split(',').map((opt) => ({
        text: opt.trim(),
        value: opt.trim().toLowerCase(),
      }));
    }

    options.forEach((opt) => addOption(opt));
  }

  const fieldWrapper = createFieldWrapper(fd);
  fieldWrapper.append(select);
  fieldWrapper.prepend(createLabel(fd));

  return { field: select, fieldWrapper };
};

const createConfirmation = (fd, form) => {
  form.dataset.confirmation = new URL(fd.Value).pathname;

  return {};
};

const createSubmit = (fd) => {
  const button = document.createElement('button');
  button.textContent = fd.Label || fd.Name;
  button.classList.add('button');
  button.type = 'submit';

  // Download icon SVG
  const icon = document.createElement('span');
  icon.className = 'download-icon';
  icon.innerHTML = `
    <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2a1 1 0 0 1 1 1v8.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L9 11.586V3a1 1 0 0 1 1-1zm-7 13a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1z"/>
    </svg>
  `;

  button.appendChild(icon);

  const fieldWrapper = createFieldWrapper(fd);
  fieldWrapper.append(button);
  return { field: button, fieldWrapper };
};

const createTextArea = (fd) => {
  const field = document.createElement('textarea');
  setCommonAttributes(field, fd);

  const fieldWrapper = createFieldWrapper(fd);
  const label = createLabel(fd);
  field.setAttribute('aria-labelledby', label.id);
  fieldWrapper.append(field);
  fieldWrapper.prepend(label);

  return { field, fieldWrapper };
};

const createInput = (fd) => {
  const field = document.createElement('input');
  field.type = fd.Type;
  setCommonAttributes(field, fd);

  const fieldWrapper = createFieldWrapper(fd);
  const label = createLabel(fd);
  field.setAttribute('aria-labelledby', label.id);
  fieldWrapper.append(field);
  fieldWrapper.prepend(label);

  // If type is email, add validation for email format
  if (fd.Type === 'email') {
    field.addEventListener('input', () => {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const errorDiv = fieldWrapper.querySelector(`#${field.id}-error`);
      if (!emailPattern.test(field.value) && field.value) {
        if (!errorDiv) {
          const newErrorDiv = document.createElement('div');
          newErrorDiv.id = `${field.id}-error`;
          newErrorDiv.classList.add('error-message');
          newErrorDiv.textContent = 'Please enter a valid email address.';
          fieldWrapper.append(newErrorDiv);
        }
      } else if (errorDiv) {
        errorDiv.remove();
      }
    });

    // If verify email is not equal to email, add validation
    if (fd.Id === 'edit-email-address-mail-2') {
      field.addEventListener('input', () => {
        const verifyEmailField = document.querySelector('input[name="email_address[mail_1]"]');
        const errorDiv = fieldWrapper.querySelector(`#${field.id}-error`);
        if (verifyEmailField.value !== field.value) {
          if (!errorDiv) {
            const newErrorDiv = document.createElement('div');
            newErrorDiv.id = `${field.id}-error`;
            newErrorDiv.classList.add('error-message');
            newErrorDiv.textContent = 'Email addresses do not match.';
            fieldWrapper.append(newErrorDiv);
          }
        } else if (errorDiv) {
          errorDiv.remove();
        }
      });
    }
  }

  // If type is number, limit digits to maxlength
  if (fd.Type === 'number' && fd.Maxlength) {
    field.addEventListener('input', () => {
      if (field.value && field.value.length > fd.Maxlength) {
        field.value = field.value.slice(0, fd.Maxlength);
      }
    });
  }

  // If type is date, add validation for 18 years
  if (fd.Type === 'date') {
    field.addEventListener('change', () => {
      const inputDate = new Date(field.value);
      const today = new Date();
      const eighteenYearsAgo = new Date(
        today.getFullYear() - 18,
        today.getMonth(),
        today.getDate(),
      );
      if (inputDate > eighteenYearsAgo) {
        const errorDiv = document.createElement('div');
        errorDiv.id = `${field.id}-error`;
        errorDiv.classList.add('error-message');
        errorDiv.textContent = 'You must be at least 18 years old.';
        fieldWrapper.append(errorDiv);
      } else {
        const errorDiv = fieldWrapper.querySelector(`#${field.id}-error`);
        if (errorDiv) {
          errorDiv.remove();
        }
      }
    });
  }

  return { field, fieldWrapper };
};

const createFieldset = (fd) => {
  const field = document.createElement('fieldset');
  setCommonAttributes(field, fd);

  if (fd.Label) {
    const legend = document.createElement('legend');
    legend.textContent = fd.Label;
    field.append(legend);
  }

  const fieldWrapper = createFieldWrapper(fd);
  fieldWrapper.append(field);

  return { field, fieldWrapper };
};

const createToggle = (fd) => {
  const { field, fieldWrapper } = createInput(fd);
  field.type = 'checkbox';
  if (!field.value) field.value = 'on';
  field.classList.add('toggle');
  fieldWrapper.classList.add('selection-wrapper');

  const toggleSwitch = document.createElement('div');
  toggleSwitch.classList.add('switch');
  toggleSwitch.append(field);
  fieldWrapper.append(toggleSwitch);

  const slider = document.createElement('span');
  slider.classList.add('slider');
  toggleSwitch.append(slider);
  slider.addEventListener('click', () => {
    field.checked = !field.checked;
  });

  return { field, fieldWrapper };
};

const createCheckbox = (fd) => {
  const field = document.createElement('input');
  field.type = 'checkbox';
  setCommonAttributes(field, fd);

  const optionWrapper = document.createElement('fieldset');
  optionWrapper.classList.add('checkbox-option');

  const fieldWrapper = createFieldWrapper(fd);
  const label = createLabel(fd);
  field.setAttribute('aria-labelledby', label.id);

  optionWrapper.append(field, label);
  fieldWrapper.append(optionWrapper);
  return { field, fieldWrapper };
};

const createRadio = (fd) => {
  if (fd.Options) {
    const fieldWrapper = createFieldWrapper(fd);
    const label = createLabel(fd);
    fieldWrapper.append(label);

    fd.Options.split(',').forEach((opt) => {
      const optionWrapper = document.createElement('fieldset');
      optionWrapper.classList.add('radio-option');
      const radio = document.createElement('input');
      const optValue = opt.trim().toLowerCase();
      radio.type = 'radio';
      radio.name = `${fd.Name}`;
      radio.value = optValue;
      radio.id = generateFieldId(fd, `-${optValue}`);
      if (fd.Value && fd.Value.toLowerCase() === optValue) {
        radio.checked = true;
      }
      const optionLabel = document.createElement('label');
      optionLabel.setAttribute('for', radio.id);
      optionLabel.textContent = opt.trim();

      optionWrapper.append(radio, optionLabel);
      fieldWrapper.append(optionWrapper);
    });

    return { field: label, fieldWrapper };
  }
};

const FIELD_CREATOR_FUNCTIONS = {
  select: createSelect,
  heading: createHeading,
  plaintext: createPlaintext,
  'text-area': createTextArea,
  toggle: createToggle,
  submit: createSubmit,
  confirmation: createConfirmation,
  fieldset: createFieldset,
  checkbox: createCheckbox,
  radio: createRadio,
  hidden: createInput,
};

export default async function createField(fd, form) {
  fd.Id = fd.Id || generateFieldId(fd);
  const type = fd.Type.toLowerCase();
  const createFieldFunc = FIELD_CREATOR_FUNCTIONS[type] || createInput;
  const fieldElements = await createFieldFunc(fd, form);

  return fieldElements.fieldWrapper;
}
