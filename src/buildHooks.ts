import { AnyAction, ThunkDispatch } from '@reduxjs/toolkit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector, batch } from 'react-redux';
import { MutationSubState, QueryStatus, QuerySubState } from './apiState';
import {
  EndpointDefinitions,
  MutationDefinition,
  QueryDefinition,
  isQueryDefinition,
  isMutationDefinition,
} from './endpointDefinitions';
import { QueryResultSelectors, MutationResultSelectors, skipSelector } from './buildSelectors';
import {
  QueryActions,
  MutationActions,
  QueryActionCreatorResult,
  MutationActionCreatorResult,
} from './buildActionMaps';
import { UnsubscribeMutationResult, UnsubscribeQueryResult } from './buildSlice';

export interface QueryHookOptions {
  skip?: boolean;
}

export type QueryHook<D extends QueryDefinition<any, any, any, any>> = D extends QueryDefinition<
  infer QueryArg,
  any,
  any,
  any
>
  ? (arg: QueryArg, options?: QueryHookOptions) => QueryHookResult<D>
  : never;

export type QueryHookResult<D extends QueryDefinition<any, any, any, any>> = QuerySubState<D> &
  Pick<QueryActionCreatorResult<D>, 'refetch'>;

export type MutationHook<D extends MutationDefinition<any, any, any, any>> = D extends MutationDefinition<
  infer QueryArg,
  any,
  any,
  any
>
  ? () => [
      (
        arg: QueryArg
      ) => Promise<Extract<MutationSubState<D>, { status: QueryStatus.fulfilled | QueryStatus.rejected }>>,
      MutationSubState<D>
    ]
  : never;

export type Hooks<Definitions extends EndpointDefinitions> = {
  [K in keyof Definitions]: Definitions[K] extends QueryDefinition<any, any, any, any>
    ? {
        useQuery: QueryHook<Definitions[K]>;
      }
    : Definitions[K] extends MutationDefinition<any, any, any, any>
    ? {
        useMutation: MutationHook<Definitions[K]>;
      }
    : never;
};

export function buildHooks<Definitions extends EndpointDefinitions>({
  endpointDefinitions,
  querySelectors,
  queryActions,
  mutationSelectors,
  mutationActions,
  unsubscribeMutationResult,
}: {
  endpointDefinitions: Definitions;
  querySelectors: QueryResultSelectors<Definitions, any>;
  queryActions: QueryActions<Definitions>;
  unsubscribeQueryResult: UnsubscribeQueryResult;
  mutationSelectors: MutationResultSelectors<Definitions, any>;
  mutationActions: MutationActions<Definitions>;
  unsubscribeMutationResult: UnsubscribeMutationResult;
}) {
  const hooks: Hooks<Definitions> = Object.entries(endpointDefinitions).reduce<Hooks<any>>((acc, [name, endpoint]) => {
    if (isQueryDefinition(endpoint)) {
      acc[name] = { useQuery: buildQueryHook(name) };
    } else if (isMutationDefinition(endpoint)) {
      acc[name] = { useMutation: buildMutationHook(name) };
    }
    return acc;
  }, {});

  return { hooks };

  function buildQueryHook(name: string): QueryHook<any> {
    const startQuery = queryActions[name];
    const querySelector = querySelectors[name];
    return (arg, options) => {
      const dispatch = useDispatch<ThunkDispatch<any, any, AnyAction>>();
      const skip = options?.skip === true;

      const currentPromiseRef = useRef<QueryActionCreatorResult<any>>();

      useEffect(() => {
        if (skip) {
          return;
        }
        const promise = dispatch(startQuery(arg));
        currentPromiseRef.current = promise;
        return () => void promise.unsubscribe();
      }, [arg, dispatch, skip]);

      const currentState = useSelector(querySelector(skip ? skipSelector : arg));
      const refetch = useCallback(() => void currentPromiseRef.current?.refetch(), []);

      return useMemo(() => ({ ...currentState, refetch }), [currentState, refetch]);
    };
  }

  function buildMutationHook(name: string): MutationHook<any> {
    return () => {
      const dispatch = useDispatch<ThunkDispatch<any, any, AnyAction>>();
      const [requestId, setRequestId] = useState<string>();

      const promiseRef = useRef<MutationActionCreatorResult<any>>();

      useEffect(() => () => void promiseRef.current?.unsubscribe(), []);

      const triggerMutation = useCallback(
        function (args) {
          let promise: MutationActionCreatorResult<any>;
          batch(() => {
            // false positive:
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            promiseRef.current?.unsubscribe();
            promise = dispatch(mutationActions[name](args));
            promiseRef.current = promise;
            setRequestId(promise.requestId);
          });
          return promise!;
        },
        [dispatch]
      );

      return [triggerMutation, useSelector(mutationSelectors[name](requestId || skipSelector))];
    };
  }
}