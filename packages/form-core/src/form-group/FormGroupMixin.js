import { dedupeMixin, html, SlotMixin, DisabledMixin } from '@lion/core';
import { FormControlMixin } from '../FormControlMixin.js';
import { FormControlsCollection } from '../registration/FormControlsCollection.js';
import { FormRegistrarMixin } from '../registration/FormRegistrarMixin.js';
import { ValidateMixin } from '../validate/ValidateMixin.js';
import { getAriaElementsInRightDomOrder } from '../utils/getAriaElementsInRightDomOrder.js';
import { FormElementsHaveNoError } from './FormElementsHaveNoError.js';

/**
 * @typedef {import('../../types/form-group/FormGroupMixinTypes').FormGroupMixin} FormGroupMixin
 * @typedef {import('../../types/form-group/FormGroupMixinTypes').FormGroupHost} FormGroupHost
 * @typedef {import('../../types/FormControlMixinTypes').FormControlHost} FormControlHost
 * @typedef {import('../../types/registration/FormRegisteringMixinTypes').FormRegisteringHost} FormRegisteringHost
 * @typedef {import('../../types/registration/FormRegistrarMixinTypes').ElementWithParentFormGroup} ElementWithParentFormGroup
 * @typedef {FormControlHost & HTMLElement & {_parentFormGroup?: HTMLElement, checked?: boolean, disabled: boolean, hasFeedbackFor: string[], makeRequestToBeDisabled: Function }} FormControl
 */

/**
 * @desc Form group mixin serves as the basis for (sub) forms. Designed to be put on
 * elements with [role="group|radiogroup"] (think of checkbox-group, radio-group, fieldset).
 * It bridges all the functionality of the child form controls:
 * ValidateMixin, InteractionStateMixin, FormatMixin, FormControlMixin etc.
 * It is designed to be used on top of FormRegistrarMixin and ChoiceGroupMixin.
 * Also, it is th basis of the LionFieldset element (which supports name based retrieval of
 * children via formElements and the automatic grouping of formElements via '[]').
 *
 * @type {FormGroupMixin}
 * @param {import('@open-wc/dedupe-mixin').Constructor<import('@lion/core').LitElement>} superclass
 */
const FormGroupMixinImplementation = superclass =>
  class FormGroupMixin extends FormRegistrarMixin(
    FormControlMixin(ValidateMixin(DisabledMixin(SlotMixin(superclass)))),
  ) {
    /** @type {any} */
    static get properties() {
      return {
        /**
         * Interaction state that can be used to compute the visibility of
         * feedback messages
         */
        submitted: {
          type: Boolean,
          reflect: true,
        },
        /**
         * Interaction state that will be active when any of the children
         * is focused.
         */
        focused: {
          type: Boolean,
          reflect: true,
        },
        /**
         * Interaction state that will be active when any of the children
         * is dirty (see InteractionStateMixin for more details.)
         */
        dirty: {
          type: Boolean,
          reflect: true,
        },
        /**
         * Interaction state that will be active when the group as a whole is
         * blurred
         */
        touched: {
          type: Boolean,
          reflect: true,
        },
        /**
         * Interaction state that will be active when all of the children
         * are prefilled (see InteractionStateMixin for more details.)
         */
        prefilled: {
          type: Boolean,
          reflect: true,
        },
      };
    }

    get _inputNode() {
      return this;
    }

    // @ts-ignore
    get modelValue() {
      return this._getFromAllFormElements('modelValue');
    }

    set modelValue(values) {
      if (this.__isInitialModelValue) {
        this.__isInitialModelValue = false;
        this.registrationComplete.then(() => {
          this._setValueMapForAllFormElements('modelValue', values);
        });
      } else {
        this._setValueMapForAllFormElements('modelValue', values);
      }
    }

    get serializedValue() {
      return this._getFromAllFormElements('serializedValue');
    }

    set serializedValue(values) {
      if (this.__isInitialSerializedValue) {
        this.__isInitialSerializedValue = false;
        this.registrationComplete.then(() => {
          this._setValueMapForAllFormElements('serializedValue', values);
        });
      } else {
        this._setValueMapForAllFormElements('serializedValue', values);
      }
    }

    get formattedValue() {
      return this._getFromAllFormElements('formattedValue');
    }

    set formattedValue(values) {
      this._setValueMapForAllFormElements('formattedValue', values);
    }

    get prefilled() {
      return this._everyFormElementHas('prefilled');
    }

    constructor() {
      super();
      // ._inputNode = this, which always requires a value prop
      this.value = '';

      this.disabled = false;
      this.submitted = false;
      this.dirty = false;
      this.touched = false;
      this.focused = false;
      this.__addedSubValidators = false;
      this.__isInitialModelValue = true;
      this.__isInitialSerializedValue = true;

      this._checkForOutsideClick = this._checkForOutsideClick.bind(this);

      this.addEventListener('focusin', this._syncFocused);
      this.addEventListener('focusout', this._onFocusOut);
      this.addEventListener('dirty-changed', this._syncDirty);
      this.addEventListener('validate-performed', this.__onChildValidatePerformed);

      this.defaultValidators = [new FormElementsHaveNoError()];

      this.__descriptionElementsInParentChain = new Set();
    }

    connectedCallback() {
      super.connectedCallback();
      this.setAttribute('role', 'group');

      this.initComplete.then(() => {
        this.__isInitialModelValue = false;
        this.__isInitialSerializedValue = false;
        this.__initInteractionStates();
      });
    }

    disconnectedCallback() {
      super.disconnectedCallback();

      if (this.__hasActiveOutsideClickHandling) {
        document.removeEventListener('click', this._checkForOutsideClick);
        this.__hasActiveOutsideClickHandling = false;
      }
      this.__descriptionElementsInParentChain.clear();
    }

    __initInteractionStates() {
      this.formElements.forEach(el => {
        if (typeof el.initInteractionState === 'function') {
          el.initInteractionState();
        }
      });
    }

    /**
     * @override from FormControlMixin
     */
    _triggerInitialModelValueChangedEvent() {
      this.registrationComplete.then(() => {
        this.__dispatchInitialModelValueChangedEvent();
      });
    }

    /**
     * @param {import('@lion/core').PropertyValues } changedProperties
     */
    updated(changedProperties) {
      super.updated(changedProperties);

      if (changedProperties.has('disabled')) {
        if (this.disabled) {
          this.__requestChildrenToBeDisabled();
        } else {
          this.__retractRequestChildrenToBeDisabled();
        }
      }

      if (changedProperties.has('focused')) {
        if (this.focused === true) {
          this.__setupOutsideClickHandling();
        }
      }
    }

    __setupOutsideClickHandling() {
      if (!this.__hasActiveOutsideClickHandling) {
        document.addEventListener('click', this._checkForOutsideClick);
        this.__hasActiveOutsideClickHandling = true;
      }
    }

    /**
     * @param {Event} event
     */
    _checkForOutsideClick(event) {
      const outsideGroupClicked = !this.contains(/** @type {Node} */ (event.target));
      if (outsideGroupClicked) {
        this.touched = true;
      }
    }

    __requestChildrenToBeDisabled() {
      this.formElements.forEach(child => {
        if (child.makeRequestToBeDisabled) {
          child.makeRequestToBeDisabled();
        }
      });
    }

    __retractRequestChildrenToBeDisabled() {
      this.formElements.forEach(child => {
        if (child.retractRequestToBeDisabled) {
          child.retractRequestToBeDisabled();
        }
      });
    }

    // eslint-disable-next-line class-methods-use-this
    _inputGroupTemplate() {
      return html`
        <div class="input-group">
          <slot></slot>
        </div>
      `;
    }

    /**
     * @desc Handles interaction state 'submitted'.
     * This allows children to enable visibility of validation feedback
     */
    submitGroup() {
      this.submitted = true;
      this.formElements.forEach(child => {
        if (typeof child.submitGroup === 'function') {
          child.submitGroup();
        } else {
          child.submitted = true; // eslint-disable-line no-param-reassign
        }
      });
    }

    resetGroup() {
      this.formElements.forEach(child => {
        if (typeof child.resetGroup === 'function') {
          child.resetGroup();
        } else if (typeof child.reset === 'function') {
          child.reset();
        }
      });

      this.resetInteractionState();
    }

    clearGroup() {
      this.formElements.forEach(child => {
        if (typeof child.clearGroup === 'function') {
          child.clearGroup();
        } else if (typeof child.clear === 'function') {
          child.clear();
        }
      });

      this.resetInteractionState();
    }

    resetInteractionState() {
      this.submitted = false;
      this.touched = false;
      this.dirty = false;
      this.formElements.forEach(formElement => {
        if (typeof formElement.resetInteractionState === 'function') {
          formElement.resetInteractionState();
        }
      });
    }

    /**
     * @param {string} property
     */
    _getFromAllFormElements(property, filterFn = (/** @type {FormControl} */ el) => !el.disabled) {
      const result = {};
      // @ts-ignore
      this.formElements._keys().forEach(name => {
        const elem = this.formElements[name];
        if (elem instanceof FormControlsCollection) {
          result[name] = elem.filter(el => filterFn(el)).map(el => el[property]);
        } else if (filterFn(elem)) {
          if (typeof elem._getFromAllFormElements === 'function') {
            result[name] = elem._getFromAllFormElements(property, filterFn);
          } else {
            result[name] = elem[property];
          }
        }
      });
      return result;
    }

    /**
     * @param {string | number} property
     * @param {any} value
     */
    _setValueForAllFormElements(property, value) {
      this.formElements.forEach(el => {
        el[property] = value; // eslint-disable-line no-param-reassign
      });
    }

    /**
     * @param {string} property
     * @param {{ [x: string]: any; }} values
     */
    _setValueMapForAllFormElements(property, values) {
      if (values && typeof values === 'object') {
        Object.keys(values).forEach(name => {
          if (Array.isArray(this.formElements[name])) {
            this.formElements[name].forEach((
              /** @type {FormControl} */ el,
              /** @type {number} */ index,
            ) => {
              el[property] = values[name][index]; // eslint-disable-line no-param-reassign
            });
          }
          if (this.formElements[name]) {
            this.formElements[name][property] = values[name];
          }
        });
      }
    }

    /**
     * @param {string} property
     */
    _anyFormElementHas(property) {
      return Object.keys(this.formElements).some(name => {
        if (Array.isArray(this.formElements[name])) {
          return this.formElements[name].some((/** @type {FormControl} */ el) => !!el[property]);
        }
        return !!this.formElements[name][property];
      });
    }

    /**
     * @param {string} state one of ValidateHost.validationTypes
     */
    _anyFormElementHasFeedbackFor(state) {
      return Object.keys(this.formElements).some(name => {
        if (Array.isArray(this.formElements[name])) {
          return this.formElements[name].some((/** @type {FormControl} */ el) =>
            Boolean(el.hasFeedbackFor && el.hasFeedbackFor.includes(state)),
          );
        }
        return Boolean(
          this.formElements[name].hasFeedbackFor &&
            this.formElements[name].hasFeedbackFor.includes(state),
        );
      });
    }

    /**
     * @param {string} property
     */
    _everyFormElementHas(property) {
      return Object.keys(this.formElements).every(name => {
        if (Array.isArray(this.formElements[name])) {
          return this.formElements[name].every((/** @type {FormControl} */ el) => !!el[property]);
        }
        return !!this.formElements[name][property];
      });
    }

    /**
     * Gets triggered by event 'validate-performed' which enabled us to handle 2 different situations
     *    - react on modelValue change, which says something about the validity as a whole
     *        (at least two checkboxes for instance) and nothing about the children's values
     *    - children validity states have changed, so fieldset needs to update itself based on that
     * @param {Event} ev
     */
    __onChildValidatePerformed(ev) {
      if (ev && this.isRegisteredFormElement(/** @type {FormControl} */ (ev.target))) {
        this.validate();
      }
    }

    _syncFocused() {
      this.focused = this._anyFormElementHas('focused');
    }

    /**
     * @param {Event} ev
     */
    _onFocusOut(ev) {
      const lastEl = this.formElements[this.formElements.length - 1];
      if (ev.target === lastEl) {
        this.touched = true;
      }
      this.focused = false;
    }

    _syncDirty() {
      this.dirty = this._anyFormElementHas('dirty');
    }

    /**
     * Traverses the _parentFormGroup tree, and gathers all aria description elements
     * (feedback and helptext) that should be provided to children.
     *
     * In the example below, when the input for 'street' has focus, a screenreader user
     * would hear the #group-error.
     * In case one of the inputs was in error state as well, the SR user would
     * first hear the local error, followed by #group-error
     * @example
     * <lion-fieldset name="address">
     *   <lion-input name="street" label="Street" .modelValue="${'Park Avenue'}"></lion-input>
     *   <lion-input name="number" label="Number" .modelValue="${100}">...</lion-input>
     *   <div slot="feedback" id="group-error">
     *      Park Avenue only has numbers up to 80
     *   </div>
     * </lion-fieldset>
     */
    __storeAllDescriptionElementsInParentChain() {
      const unTypedThis = /** @type {unknown} */ (this);
      let parent = /** @type {FormControlHost & { _parentFormGroup:any }} */ (unTypedThis);
      while (parent) {
        const descriptionElements = parent._getAriaDescriptionElements();
        const orderedEls = getAriaElementsInRightDomOrder(descriptionElements, { reverse: true });
        orderedEls.forEach(el => {
          this.__descriptionElementsInParentChain.add(el);
        });
        // Also check if the newly added child needs to refer grandparents
        parent = parent._parentFormGroup;
      }
    }

    /**
     * @param {FormControl} child
     */
    __linkParentMessages(child) {
      this.__descriptionElementsInParentChain.forEach(el => {
        if (typeof child.addToAriaDescribedBy === 'function') {
          child.addToAriaDescribedBy(el, { reorder: false });
        }
      });
    }

    /**
     * @param {FormControl} child
     */
    __unlinkParentMessages(child) {
      this.__descriptionElementsInParentChain.forEach(el => {
        if (typeof child.removeFromAriaDescribedBy === 'function') {
          child.removeFromAriaDescribedBy(el);
        }
      });
    }

    /**
     * @override of FormRegistrarMixin.
     * @desc Connects ValidateMixin and DisabledMixin
     * On top of this, error messages of children are linked to their parents
     * @param {FormControl} child
     * @param {number} indexToInsertAt
     */
    addFormElement(child, indexToInsertAt) {
      super.addFormElement(child, indexToInsertAt);
      if (this.disabled) {
        child.makeRequestToBeDisabled();
      }
      if (!this.__descriptionElementsInParentChain.size) {
        this.__storeAllDescriptionElementsInParentChain();
      }
      this.__linkParentMessages(child);
      this.validate({ clearCurrentResult: true });

      if (typeof child.addToAriaLabelledBy === 'function' && this._labelNode) {
        child.addToAriaLabelledBy(this._labelNode, { reorder: false });
      }
    }

    /**
     * Gathers initial model values of all children. Used
     * when resetGroup() is called.
     */
    get _initialModelValue() {
      return this._getFromAllFormElements('_initialModelValue');
    }

    /**
     * @override of FormRegistrarMixin. Connects ValidateMixin
     * @param {FormRegisteringHost & FormControl} el
     */
    removeFormElement(el) {
      super.removeFormElement(el);
      this.validate({ clearCurrentResult: true });

      if (typeof el.removeFromAriaLabelledBy === 'function' && this._labelNode) {
        el.removeFromAriaLabelledBy(this._labelNode, { reorder: false });
      }
      this.__unlinkParentMessages(el);
    }
  };

export const FormGroupMixin = dedupeMixin(FormGroupMixinImplementation);
